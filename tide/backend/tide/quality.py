"""Frame quality: is this picture clear enough to find and identify fish? (ported from SeaSieve)

These are image-quality indicators, not turbidity. Each picture gets a 0–100 score and a category:

    clear       fish are easy to see
    moderate    degraded: the cleared-up (CLAHE) picture is searched too
    muddy       hard: fish may be missed; cleared-up picture searched too
    obscured    too murky to identify fish: detections here need a person

Thresholds are settings (app.yaml `quality`) and must be calibrated per site. The clarity index
(clarity.py) stays the per-point/video estimate used for visibility; this is the per-picture filter.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from .config import QualityConfig

CATEGORIES = ("clear", "moderate", "muddy", "obscured")


@dataclass
class QualityResult:
    score: float
    category: str
    reasons: list[str] = field(default_factory=list)

    @property
    def degraded(self) -> bool:
        return self.category != "clear"

    @property
    def unidentifiable(self) -> bool:
        return self.category == "obscured"


def _clip01(x: float) -> float:
    return float(min(1.0, max(0.0, x)))


def metrics(image_bgr: np.ndarray, width: int) -> dict:
    h, w = image_bgr.shape[:2]
    img = cv2.resize(image_bgr, (width, max(1, round(h * width / w))), interpolation=cv2.INTER_AREA) if w > width \
        else image_bgr
    grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    gh, gw = grey.shape
    th, tw = max(1, gh // 8), max(1, gw // 8)
    tiles = [grey[y:y + th, x:x + tw].std() for y in range(0, gh - th + 1, th) for x in range(0, gw - tw + 1, tw)]
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    return {
        "contrast": float(grey.std()),
        "brightness": float(grey.mean()),
        "sharpness": float(cv2.Laplacian(grey, cv2.CV_64F).var()),
        "edge_density": float((cv2.Canny(grey, 50, 150) > 0).mean()),
        "local_contrast": float(np.mean(tiles)) if tiles else float(grey.std()),
        "color_cast": float(np.hypot(lab[..., 1].mean() - 128.0, lab[..., 2].mean() - 128.0)),
        "dark_channel": float(cv2.erode(img.min(axis=2), np.ones((15, 15), np.uint8)).mean()),
    }


def score(m: dict) -> float:
    """0–100. Exposure, haze and colour only count when there is visible structure (SeaSieve finding:
    a featureless frame otherwise scored ~18)."""
    parts = {
        "contrast": _clip01(m["contrast"] / 55.0),
        "local_contrast": _clip01(m["local_contrast"] / 30.0),
        "sharpness": _clip01(np.log1p(m["sharpness"]) / np.log1p(800.0)),
        "edges": _clip01(m["edge_density"] / 0.08),
        "exposure": _clip01(1.0 - abs(m["brightness"] - 120.0) / 120.0),
        "haze": _clip01(1.0 - max(0.0, m["dark_channel"] - 25.0) / 110.0),
        "color": _clip01(1.0 - m["color_cast"] / 45.0),
    }
    structural = {"contrast": 0.22, "local_contrast": 0.18, "sharpness": 0.2, "edges": 0.12}
    context = {"exposure": 0.1, "haze": 0.12, "color": 0.06}
    s = sum(parts[k] * w for k, w in structural.items())
    c = s / sum(structural.values()) * sum(parts[k] * w for k, w in context.items())
    return round(float(100.0 * (s + c)), 1)


def assess(image_bgr: np.ndarray, cfg: QualityConfig) -> QualityResult:
    m = metrics(image_bgr, cfg.analysis_width)
    sc = score(m)
    cat = ("clear" if sc >= cfg.clear_min_score else "moderate" if sc >= cfg.moderate_min_score
           else "muddy" if sc >= cfg.muddy_min_score else "obscured")
    reasons = []
    if m["sharpness"] < cfg.blur_threshold:
        reasons.append("blurred")
    if m["contrast"] < cfg.min_contrast:
        reasons.append("low contrast")
    if m["dark_channel"] > 90:
        reasons.append("hazy or turbid")
    if m["brightness"] < 40:
        reasons.append("dark")
    i = CATEGORIES.index(cat)
    if "blurred" in reasons and "low contrast" in reasons and i < 2:
        cat = CATEGORIES[i + 1]  # both: one category worse
    elif "hazy or turbid" in reasons and cat == "clear":
        cat = "moderate"  # haze veils fish even when overlays look sharp (SeaSieve finding)
    return QualityResult(sc, cat, reasons)
