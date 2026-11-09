"""Clarity index: a 0–100 estimate of how clear the water looks (CLAUDE.md, "Clarity index").

It is computed on the same pictures used for detection, with OpenCV + NumPy only (no extra model,
no second pass over the video). It is NOT turbidity and never shown as NTU: light, depth and
camera exposure all change it, so it is only an estimate for comparing pictures and videos.

Each measure is scaled to 0–1 (1 = clearer) and combined with the weights in config/app.yaml
(`clarity.weights`):

    contrast   RMS contrast of the grey picture
    sharpness  variance of the Laplacian (edge strength)
    haze       1 – dark-channel estimate (haze and suspended sediment lift the dark channel)
    colour     red-channel loss against green/blue (red disappears first in turbid water)
    particles  1 – density of small bright specks (suspended particles, marine snow)
"""
from dataclasses import dataclass

import cv2
import numpy as np

from .config import CLARITY_MEASURES, ClarityConfig

_WORK_WIDTH = 640  # measures are taken on a 640-px-wide copy so they don't depend on the camera resolution


@dataclass(frozen=True)
class ClaritySummary:
    """Per-video clarity: median, range and direction over the video's pictures."""

    median: float | None
    min: float | None
    max: float | None
    trend: str | None  # "improving" | "worsening" | "stable"


def measures(image_bgr: np.ndarray) -> dict[str, float]:
    """The five clarity measures for one picture, each 0–1 where 1 means clearer water."""
    img = _resize(image_bgr)
    grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    g = grey.astype(np.float32) / 255.0

    contrast = min(1.0, float(g.std()) / 0.25)
    lap_var = float(cv2.Laplacian(grey, cv2.CV_64F).var())
    sharpness = 1.0 - float(np.exp(-lap_var / 300.0))

    dark = cv2.erode(img.min(axis=2), np.ones((15, 15), np.uint8))
    haze = 1.0 - float(dark.mean()) / 255.0

    b, gr, r = (img[..., i].astype(np.float32).mean() for i in range(3))
    colour = min(1.0, float(r) / max(1.0, float(gr + b) / 2))

    tophat = cv2.morphologyEx(grey, cv2.MORPH_TOPHAT, np.ones((7, 7), np.uint8))
    specks = (tophat > 40).astype(np.uint8)
    n, _, stats, _ = cv2.connectedComponentsWithStats(specks)
    small = int(((stats[1:, cv2.CC_STAT_AREA] >= 2) & (stats[1:, cv2.CC_STAT_AREA] <= 30)).sum()) if n > 1 else 0
    density = small / (img.shape[0] * img.shape[1] / 10_000)  # specks per 100×100 px
    particles = 1.0 - min(1.0, density / 5.0)

    return {k: float(v) for k, v in (("contrast", contrast), ("sharpness", sharpness), ("haze", haze),
                                     ("colour", colour), ("particles", particles))}


def clarity_index(image_bgr: np.ndarray, cfg: ClarityConfig) -> float:
    """Weighted clarity index for one picture, 0–100 (100 = clearest)."""
    m = measures(image_bgr)
    total = sum(cfg.weights[k] for k in CLARITY_MEASURES)
    # float(): numpy scalars would be stored as bytes by SQLite
    return round(float(100.0 * sum(cfg.weights[k] * m[k] for k in CLARITY_MEASURES) / total), 1)


def summarise(values: list[float], stable_band: float = 5.0) -> ClaritySummary:
    """Median, min, max and trend of a video's clarity values (in time order).

    Trend compares the median of the first third with the last third: a change larger than
    `stable_band` index points is "improving" or "worsening", otherwise "stable".
    """
    vals = [v for v in values if v is not None]
    if not vals:
        return ClaritySummary(None, None, None, None)
    arr = np.asarray(vals, dtype=np.float32)
    trend = None
    if len(arr) >= 3:
        third = max(1, len(arr) // 3)
        delta = float(np.median(arr[-third:]) - np.median(arr[:third]))
        trend = "improving" if delta > stable_band else "worsening" if delta < -stable_band else "stable"
    return ClaritySummary(round(float(np.median(arr)), 1), round(float(arr.min()), 1), round(float(arr.max()), 1), trend)


def _resize(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    if w <= _WORK_WIDTH:
        return img
    return cv2.resize(img, (_WORK_WIDTH, round(h * _WORK_WIDTH / w)), interpolation=cv2.INTER_AREA)
