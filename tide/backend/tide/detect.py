"""Fish detector: one picture in, `Detection`s out (CLAUDE.md, Module interfaces).

Interim detector: the Community Fish Detector (CFD), an RF-DETR model trained on many underwater
datasets with one class, "fish". CLAUDE.md names YOLOX as the detector, but COCO YOLOX has no fish
class and no fine-tuned YOLOX exists yet; CFD is the stand-in until it does. Its licence status is
recorded in docs/LICENCES.md and needs team/client approval. No other module depends on RF-DETR
types: swap the model here and keep the `Detection` shape.

Weights load from disk only (config `detect.checkpoint` under `models.dir`); nothing is downloaded.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import cv2
import numpy as np

from .config import DetectConfig
from .device import GPU_LOCK, torch_device

log = logging.getLogger(__name__)


class ModelMissingError(RuntimeError):
    """The model weights aren't in the models folder. The message is plain English."""


@dataclass
class Detection:
    frame_idx: int  # 0 for images
    t_s: float  # 0.0 for images
    box: tuple[float, float, float, float]  # x1, y1, x2, y2 in pixels
    cls: str  # "fish" | "invertebrate:<type>"
    conf: float
    track_id: str | None  # same fish across frames; None for images (one track per detection)


class Detector(Protocol):
    name: str

    def detect(self, image_bgr: np.ndarray, frame_idx: int = 0, t_s: float = 0.0,
               enhance: bool = False) -> list[Detection]: ...


def clahe(image_bgr: np.ndarray, clip_limit: float = 2.0, grid: int = 8) -> np.ndarray:
    """'Clear up murky water': contrast-limited histogram equalisation on the L channel of LAB.

    The cleared-up picture is only an extra view for the detector; it is never shown as evidence.
    """
    lab = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(grid, grid)).apply(l)
    return cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)


def auto_gamma(image_bgr: np.ndarray) -> np.ndarray:
    """Brighten or darken so the mean brightness moves towards mid-grey (gamma kept between 0.5 and 2)."""
    mean = min(max(float(cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY).mean()) / 255.0, 0.02), 0.98)
    g = float(np.clip(np.log(0.5) / np.log(mean), 0.5, 2.0))
    return cv2.LUT(image_bgr, np.array([((i / 255.0) ** g) * 255 for i in range(256)], dtype=np.uint8))


def colour_correct(image_bgr: np.ndarray, red_ratio: float = 0.75) -> np.ndarray:
    """Give back the red that murky water absorbs (when red is weak), then balance the colours (grey world)."""
    f = image_bgr.astype(np.float32) / 255.0
    means = f.reshape(-1, 3).mean(axis=0)
    if means[2] / (means[1] + 1e-6) < red_ratio:
        b, g, r = cv2.split(f)
        r = r + (g.mean() - r.mean()) * (1.0 - r) * g
        f = cv2.merge((b, g, np.clip(r, 0, 1)))
    means = f.reshape(-1, 3).mean(axis=0) + 1e-6
    f = np.clip(f * np.clip(means.mean() / means, 0.6, 2.2), 0, 1)
    return (f * 255).astype(np.uint8)


def clear_murky(image_bgr: np.ndarray) -> np.ndarray:
    """The strongest 'clear up murky water' view: colour correction, then CLAHE, then gamma.

    In muddy survey footage the fish detector finds faint grey fish in this view that it misses in the
    original. Like `clahe`, it is only an extra view for the detector, never shown as evidence.
    """
    return auto_gamma(clahe(colour_correct(image_bgr)))


def nms(boxes: np.ndarray, scores: np.ndarray, iou: float, contain: float | None = None) -> list[int]:
    """Non-maximum suppression; returns kept indices, highest score first.

    contain: also drop a box lying at least this much inside a surer one (intersection / the smaller
    box's area). The views and tiles see one fish whole or in parts; it must stay one fish.
    """
    order = list(np.argsort(-scores))
    keep: list[int] = []
    while order:
        i = order.pop(0)
        keep.append(int(i))
        order = [j for j in order if box_iou(boxes[i], boxes[j]) < iou
                 and (contain is None or box_contain(boxes[i], boxes[j]) < contain)]
    return keep


def box_contain(a, b) -> float:
    """Intersection / the smaller box's area: 1 when one box lies wholly inside the other."""
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    small = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))
    return ix * iy / small if small > 0 else 0.0


def tile_windows(w: int, h: int, tile: int, overlap: float) -> list[tuple[int, int]]:
    """Top-left corners of overlapping tile x tile windows covering a w x h picture."""
    if w <= tile and h <= tile:
        return [(0, 0)]
    step = max(1, int(tile * (1 - overlap)))
    xs = list(range(0, max(1, w - tile + 1), step))
    ys = list(range(0, max(1, h - tile + 1), step))
    if xs[-1] + tile < w:
        xs.append(w - tile)
    if ys[-1] + tile < h:
        ys.append(h - tile)
    return [(x, y) for y in ys for x in xs]


def box_iou(a, b) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


class CfdDetector:
    """Community Fish Detector (RF-DETR) on PyTorch; GPU when available, otherwise CPU."""

    name = "Community Fish Detector (RF-DETR)"

    def __init__(self, cfg: DetectConfig):
        self.cfg = cfg
        self.device = torch_device()
        self.model = None
        self.resolution: int | None = None

    @property
    def checkpoint(self) -> Path:
        return self.cfg.checkpoint

    def load(self) -> "CfdDetector":
        """Load once at start-up and keep it (CLAUDE.md: never reload per frame or request)."""
        if self.model is not None:
            return self
        if not self.cfg.checkpoint.is_file():
            raise ModelMissingError(f"The fish detector file is missing: {self.cfg.checkpoint.name}. "
                                    "Ask the integration team to put the model files in the models folder.")
        import rfdetr  # imported here so the API starts quickly and tests run without it
        with GPU_LOCK:
            try:
                self.model = rfdetr.from_checkpoint(str(self.cfg.checkpoint), device=self.device)
            except TypeError:  # older rfdetr without the device argument
                self.model = rfdetr.from_checkpoint(str(self.cfg.checkpoint))
        cfg_obj = getattr(self.model, "model_config", None)
        self.resolution = int(getattr(cfg_obj, "resolution", 0) or 0) or None
        log.info("Loaded %s from %s on %s", self.name, self.cfg.checkpoint.name, self.device)
        return self

    def _predict(self, image_bgr: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        return self._predict_many([image_bgr])[0]

    def _predict_many(self, images_bgr: list[np.ndarray]) -> list[tuple[np.ndarray, np.ndarray]]:
        """One detector call for several pictures (views or tiles): faster than one call each on the GPU."""
        rgb = [np.ascontiguousarray(cv2.cvtColor(im, cv2.COLOR_BGR2RGB)) for im in images_bgr]
        with GPU_LOCK:
            out = self.model.predict(rgb if len(rgb) > 1 else rgb[0], threshold=self.cfg.conf_threshold)
        outs = out if isinstance(out, (list, tuple)) else [out]
        res = []
        for o in outs:
            xyxy = np.asarray(getattr(o, "xyxy"), dtype=np.float32).reshape(-1, 4)
            conf = getattr(o, "confidence", None)
            conf = np.ones(len(xyxy), np.float32) if conf is None else np.asarray(conf, np.float32)
            if len(conf) != len(xyxy):
                raise RuntimeError("The fish detector returned results in an unexpected format.")
            res.append((xyxy, conf))
        return res

    def detect(self, image_bgr: np.ndarray, frame_idx: int = 0, t_s: float = 0.0,
               enhance: bool = False) -> list[Detection]:
        """Every fish box at or above `detect.conf_threshold`.

        With `enhance` (murky pictures), two cleared-up views are searched too, in the same detector
        call: CLAHE, and colour correction + CLAHE + gamma (`clear_murky`). Boxes of the same fish
        are merged, keeping the surest.
        """
        self.load()
        views = [image_bgr, clahe(image_bgr), clear_murky(image_bgr)] if enhance else [image_bgr]
        found = self._predict_many(views)
        boxes = np.concatenate([b for b, _ in found])
        scores = np.concatenate([s for _, s in found])
        keep = nms(boxes, scores, self.cfg.nms_iou, self.cfg.contain) if len(boxes) else []
        h, w = image_bgr.shape[:2]
        out = []
        for i in keep:
            x1, y1, x2, y2 = (float(v) for v in boxes[i])
            x1, y1, x2, y2 = max(0.0, x1), max(0.0, y1), min(float(w), x2), min(float(h), y2)
            if x2 - x1 < self.cfg.min_box_px or y2 - y1 < self.cfg.min_box_px:
                continue
            out.append(Detection(frame_idx, t_s, (x1, y1, x2, y2), "fish", float(scores[i]), None))
        return out

    def detect_tiled(self, image_bgr: np.ndarray, grid: int, frame_idx: int = 0, t_s: float = 0.0,
                     enhance: bool = False, overlap: float = 0.15) -> list[Detection]:
        """'Look closer for small fish': the whole picture plus a grid×grid of overlapping tiles, merged.

        Small, distant fish are only a few pixels wide once the whole picture is shrunk to the
        detector's input size; in a tile they are 'grid' times bigger. Boxes cut by a tile edge are
        dropped (the overlapping tile sees them whole). About grid×grid+1 times slower.
        """
        self.load()
        h, w = image_bgr.shape[:2]
        th, tw = min(h, int(h / grid * (1 + overlap))), min(w, int(w / grid * (1 + overlap)))
        boxes, scores = [], []
        for d in self.detect(image_bgr, frame_idx, t_s, enhance=enhance):
            boxes.append(d.box)
            scores.append(d.conf)
        for gy in range(grid):
            for gx in range(grid):
                y0, x0 = min(h - th, int(gy * h / grid)), min(w - tw, int(gx * w / grid))
                for d in self.detect(image_bgr[y0:y0 + th, x0:x0 + tw], frame_idx, t_s, enhance=enhance):
                    x1, y1, x2, y2 = d.box
                    edge = ((x1 <= 1 and x0 > 0) or (y1 <= 1 and y0 > 0) or (x2 >= tw - 1 and x0 + tw < w)
                            or (y2 >= th - 1 and y0 + th < h))
                    if not edge:
                        boxes.append((x1 + x0, y1 + y0, x2 + x0, y2 + y0))
                        scores.append(d.conf)
        if not boxes:
            return []
        b, s = np.asarray(boxes, np.float32), np.asarray(scores, np.float32)
        return [Detection(frame_idx, t_s, tuple(float(v) for v in b[i]), "fish", float(s[i]), None)
                for i in nms(b, s, self.cfg.nms_iou)]

    def detect_close(self, raw_bgr: np.ndarray, scale: float, frame_idx: int = 0, t_s: float = 0.0,
                     enhance: bool = False, batch: int = 4) -> list[Detection]:
        """Close search: the full-resolution picture in overlapping tiles the detector's own size.

        A 4K survey picture is shrunk about 4 times before the detector sees it whole, and small or
        distant fish (a school in the distance) vanish. In tiles they keep their real size. Murky
        pictures are searched in the `clear_murky` view (it finds the faint fish). Boxes cut by an
        inside tile edge are dropped (the overlapping tile sees them whole). `scale` maps the
        full-resolution boxes onto the picture staff see. About 15 detector runs for a 4K picture.
        """
        self.load()
        view = clear_murky(raw_bgr) if enhance else raw_bgr
        h, w = view.shape[:2]
        t = self.cfg.tile_px
        boxes, scores = [], []
        wins = tile_windows(w, h, t, self.cfg.tile_overlap)
        for i in range(0, len(wins), batch):
            chunk = wins[i:i + batch]
            found = self._predict_many([view[y:y + t, x:x + t] for x, y in chunk])
            for (x0, y0), (bx, sc) in zip(chunk, found):
                tw, th = min(t, w - x0), min(t, h - y0)
                for (x1, y1, x2, y2), s in zip(bx, sc):
                    if ((x1 <= 1 and x0 > 0) or (y1 <= 1 and y0 > 0) or (x2 >= tw - 1 and x0 + tw < w)
                            or (y2 >= th - 1 and y0 + th < h)):
                        continue
                    boxes.append((x1 + x0, y1 + y0, x2 + x0, y2 + y0))
                    scores.append(float(s))
        if not boxes:
            return []
        b, s = np.asarray(boxes, np.float32) * scale, np.asarray(scores, np.float32)
        out = []
        for i in nms(b, s, self.cfg.nms_iou, self.cfg.contain):
            x1, y1, x2, y2 = (float(v) for v in b[i])
            if x2 - x1 >= self.cfg.min_box_px and y2 - y1 >= self.cfg.min_box_px:
                out.append(Detection(frame_idx, t_s, (x1, y1, x2, y2), "fish", float(s[i]), None))
        return out

    def describe(self) -> dict:
        return {"name": self.name, "checkpoint": self.cfg.checkpoint.name, "device": self.device,
                "resolution": self.resolution}
