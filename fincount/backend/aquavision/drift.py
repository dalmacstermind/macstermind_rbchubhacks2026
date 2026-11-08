"""Drift filter: tracks that move exactly with the water (debris, weed, sediment, bubbles).

Ported from SeaSieve. For each tracked object we compare how far its box moved between two
pictures with the background's optical flow around it (Farneback). Debris drifts with the local
flow; fish usually don't. Fish can also drift with the current, so this is a review signal, never
an automatic rejection: drifting tracks aren't counted until a person confirms them.
Settings: app.yaml `drift`.
"""
from __future__ import annotations

from collections import defaultdict

import cv2
import numpy as np

from .config import DriftConfig

FLOW_WIDTH = 320


def _flow(prev_bgr: np.ndarray, cur_bgr: np.ndarray) -> tuple[np.ndarray, float]:
    h, w = prev_bgr.shape[:2]
    s = FLOW_WIDTH / w
    size = (FLOW_WIDTH, max(1, round(h * s)))
    a = cv2.cvtColor(cv2.resize(prev_bgr, size, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    b = cv2.cvtColor(cv2.resize(cur_bgr, size, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    return cv2.calcOpticalFlowFarneback(a, b, None, 0.5, 3, 15, 3, 5, 1.2, 0), s


def _median(flow: np.ndarray, mask: np.ndarray) -> np.ndarray | None:
    if mask.sum() < 8:
        return None
    return np.array([np.median(flow[..., 0][mask]), np.median(flow[..., 1][mask])])


class DriftFilter:
    """Feed picture pairs with each picture's boxes (track id → x1, y1, x2, y2); ask which tracks drift."""

    def __init__(self, cfg: DriftConfig):
        self.cfg = cfg
        self._sims: dict[str, list[float]] = defaultdict(list)
        self._bg: dict[str, list[float]] = defaultdict(list)
        self._prev: tuple[np.ndarray, dict[str, tuple]] | None = None

    def add(self, image_bgr: np.ndarray, boxes: dict[str, tuple]) -> None:
        if not self.cfg.enabled:
            return
        if self._prev is not None:
            prev_img, prev_boxes = self._prev
            common = set(prev_boxes) & set(boxes)
            if common:
                self._pair(prev_img, image_bgr, prev_boxes, boxes, common)
        self._prev = (image_bgr, boxes)

    def _pair(self, prev_img, cur_img, prev_boxes, cur_boxes, common) -> None:
        flow, s = _flow(prev_img, cur_img)
        fh, fw = flow.shape[:2]
        objects = np.zeros((fh, fw), bool)
        for b in prev_boxes.values():
            x1, y1, x2, y2 = (np.asarray(b) * s).astype(int)
            objects[max(0, y1):max(0, y2), max(0, x1):max(0, x2)] = True
        for key in common:
            pb, cb = np.asarray(prev_boxes[key]) * s, np.asarray(cur_boxes[key]) * s
            x1, y1, x2, y2 = pb.astype(int)
            bw, bh = max(2, x2 - x1), max(2, y2 - y1)
            ring = np.zeros((fh, fw), bool)
            ring[max(0, y1 - bh):min(fh, y2 + bh), max(0, x1 - bw):min(fw, x2 + bw)] = True
            bg = _median(flow, ring & ~objects)
            if bg is None:
                continue
            disp = np.array([(cb[0] + cb[2] - pb[0] - pb[2]) / 2, (cb[1] + cb[3] - pb[1] - pb[3]) / 2])
            mb, md = float(np.linalg.norm(bg)), float(np.linalg.norm(disp))
            self._bg[key].append(mb)
            if mb < self.cfg.min_background_motion_px and md < self.cfg.min_background_motion_px:
                continue  # both still: no evidence either way
            cos = float(np.dot(bg, disp) / (mb * md + 1e-6)) if mb > 1e-3 and md > 1e-3 else 0.0
            self._sims[key].append(max(0.0, cos) * min(mb, md) / max(mb, md, 1e-6))

    def drifting(self) -> set[str]:
        """Tracks that moved like the surrounding water in at least two picture pairs."""
        return {k for k, sims in self._sims.items()
                if len(sims) >= 2 and float(np.mean(sims)) >= self.cfg.flag_threshold
                and float(np.mean(self._bg[k])) >= self.cfg.min_background_motion_px}
