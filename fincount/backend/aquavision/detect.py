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


def nms(boxes: np.ndarray, scores: np.ndarray, iou: float) -> list[int]:
    """Plain non-maximum suppression; returns kept indices, highest score first."""
    order = list(np.argsort(-scores))
    keep: list[int] = []
    while order:
        i = order.pop(0)
        keep.append(int(i))
        order = [j for j in order if box_iou(boxes[i], boxes[j]) < iou]
    return keep


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
        rgb = np.ascontiguousarray(cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB))
        with GPU_LOCK:
            out = self.model.predict(rgb, threshold=self.cfg.conf_threshold)
        xyxy = np.asarray(getattr(out, "xyxy"), dtype=np.float32).reshape(-1, 4)
        conf = getattr(out, "confidence", None)
        conf = np.ones(len(xyxy), np.float32) if conf is None else np.asarray(conf, np.float32)
        if len(conf) != len(xyxy):
            raise RuntimeError("The fish detector returned results in an unexpected format.")
        return xyxy, conf

    def detect(self, image_bgr: np.ndarray, frame_idx: int = 0, t_s: float = 0.0,
               enhance: bool = False) -> list[Detection]:
        """Every fish box at or above `detect.conf_threshold`.

        With `enhance`, the cleared-up (CLAHE) picture is searched too and overlapping boxes are
        merged, keeping the higher confidence: in murky water this mostly raises the confidence of
        fish already found rather than adding new boxes.
        """
        self.load()
        boxes, scores = self._predict(image_bgr)
        if enhance:
            b2, s2 = self._predict(clahe(image_bgr))
            boxes, scores = np.concatenate([boxes, b2]), np.concatenate([scores, s2])
        keep = nms(boxes, scores, self.cfg.nms_iou) if len(boxes) else []
        h, w = image_bgr.shape[:2]
        out = []
        for i in keep:
            x1, y1, x2, y2 = (float(v) for v in boxes[i])
            x1, y1, x2, y2 = max(0.0, x1), max(0.0, y1), min(float(w), x2), min(float(h), y2)
            if x2 - x1 < self.cfg.min_box_px or y2 - y1 < self.cfg.min_box_px:
                continue
            out.append(Detection(frame_idx, t_s, (x1, y1, x2, y2), "fish", float(scores[i]), None))
        return out

    def describe(self) -> dict:
        return {"name": self.name, "checkpoint": self.cfg.checkpoint.name, "device": self.device,
                "resolution": self.resolution}
