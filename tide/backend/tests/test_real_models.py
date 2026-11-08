"""Real models from backend/models (Community Fish Detector RF-DETR + BioCLIP 2).

    pytest -m models

Skipped when the model files aren't there (`python -m tide.fetch_models`). Pictures are made
at test time; no survey media is committed.
"""
import time

import cv2
import numpy as np
import pytest

from tide.config import load_vision_config
from tide.detect import CfdDetector, clahe
from tide.species import BioClipEncoder, ReferenceIndex, match

pytestmark = pytest.mark.models
CFG = load_vision_config()


def _fish_picture() -> np.ndarray:
    """A crude fish drawn with OpenCV: enough to check the models run, not to measure accuracy."""
    img = np.full((480, 640, 3), (110, 120, 70), np.uint8)
    cv2.ellipse(img, (320, 240), (120, 45), 0, 0, 360, (60, 90, 150), -1)
    cv2.fillPoly(img, [np.array([[200, 240], [140, 190], [140, 290]])], (60, 90, 150))
    cv2.circle(img, (400, 230), 8, (20, 20, 20), -1)
    return cv2.GaussianBlur(img, (5, 5), 0)


@pytest.mark.skipif(not CFG.detect.checkpoint.is_file(), reason="fish detector weights not installed")
def test_detector_loads_and_returns_valid_boxes():
    det = CfdDetector(CFG.detect).load()
    img = _fish_picture()
    t = time.time()
    out = det.detect(img, enhance=True)
    print(f"{len(out)} boxes in {time.time() - t:.2f}s on {det.device}")
    for d in out:
        x1, y1, x2, y2 = d.box
        assert 0 <= x1 < x2 <= img.shape[1] and 0 <= y1 < y2 <= img.shape[0]
        assert CFG.detect.conf_threshold <= d.conf <= 1 and d.cls == "fish"
    assert clahe(img).shape == img.shape


@pytest.mark.skipif(not (CFG.species.model_dir / "open_clip_config.json").is_file(),
                    reason="BioCLIP 2 not installed")
def test_bioclip_embeds_and_matches_itself():
    enc = BioClipEncoder(CFG.species).load()
    img = _fish_picture()
    v = enc.encode([img, cv2.flip(img, 1), np.full_like(img, 30)])
    assert v.shape[0] == 3 and abs(float(np.linalg.norm(v[0])) - 1) < 1e-3
    index = ReferenceIndex.build([("drawn_fish", v[0]), ("dark", v[2])])
    assert match(v[1:2], index, CFG.species).top_k[0][0] == "drawn_fish"
