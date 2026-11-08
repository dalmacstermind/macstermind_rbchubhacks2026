"""Static pictures: skip the detector when a picture is the same as the last one searched.

Ported from SeaSieve. A static picture is not an empty one: a fish can hold still for a long time.
So nothing is thrown away. For a static picture the detector isn't run again and the boxes of the
last searched picture are carried over (the tracker keeps following the same fish). Long static
runs are searched again every `periodic_interval_s`. A small fish moving in a still scene changes
one part of the picture strongly, so a local check stops such pictures counting as static.
Settings: app.yaml `static_filter`.
"""
from __future__ import annotations

import cv2
import numpy as np

from .config import StaticFilterConfig


def _prepare(img_bgr: np.ndarray, width: int) -> np.ndarray:
    h, w = img_bgr.shape[:2]
    small = cv2.resize(img_bgr, (width, max(1, round(h * width / w))), interpolation=cv2.INTER_AREA)
    return cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (3, 3), 0)


def max_tile_change(diff: np.ndarray, grid: int = 8, pixel_thr: int = 18) -> float:
    """Largest share of clearly changed pixels in any one of grid×grid tiles."""
    changed = (diff > pixel_thr).astype(np.float32)
    h, w = changed.shape
    th, tw = max(1, h // grid), max(1, w // grid)
    return float(max(changed[y:y + th, x:x + tw].mean()
                     for y in range(0, h - th + 1, th) for x in range(0, w - tw + 1, tw)))


def ssim(a: np.ndarray, b: np.ndarray) -> float:
    """Structural similarity (Wang et al. 2004) of two grey pictures, 1 = identical."""
    a, b = a.astype(np.float64), b.astype(np.float64)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    blur = lambda x: cv2.GaussianBlur(x, (7, 7), 1.5)  # noqa: E731
    ma, mb = blur(a), blur(b)
    va, vb, cov = blur(a * a) - ma * ma, blur(b * b) - mb * mb, blur(a * b) - ma * mb
    s = ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2))
    return float(s.mean())


class StaticFilter:
    """Decides, picture by picture in time order, whether the detector needs to run."""

    def __init__(self, cfg: StaticFilterConfig):
        self.cfg = cfg
        k = 0.6 if cfg.conservative else 1.0  # conservative: a smaller change already counts as "not static"
        self.diff_thr = cfg.static_diff_threshold * k
        self.local_thr = cfg.local_change_fraction * k
        self.ssim_thr = min(0.999, cfg.ssim_threshold + (1 - cfg.ssim_threshold) * 0.4) if cfg.conservative \
            else cfg.ssim_threshold
        self.interval = min(cfg.periodic_interval_s, 1.0) if cfg.conservative else cfg.periodic_interval_s
        self._ref: np.ndarray | None = None
        self._ref_t = 0.0

    def is_static(self, img_bgr: np.ndarray, t_s: float) -> bool:
        """True: same as the last searched picture, reuse its boxes. False: run the detector."""
        grey = _prepare(img_bgr, self.cfg.comparison_width)
        if not self.cfg.enabled or self._ref is None or self._ref.shape != grey.shape:
            self._ref, self._ref_t = grey, t_s
            return False
        diff = cv2.absdiff(self._ref, grey)
        static = (float(diff.mean()) < self.diff_thr and max_tile_change(diff) < self.local_thr
                  and ssim(self._ref, grey) >= self.ssim_thr)
        if static and t_s - self._ref_t < self.interval:
            return True
        self._ref, self._ref_t = grey, t_s  # changed, or time for a periodic re-check
        return False
