"""Picture filters: picture quality, static pictures, drift (tide/quality.py,
static_filter.py, drift.py) and the OC-SORT tracker option. Pictures are made at test time."""
from dataclasses import replace

import cv2
import numpy as np

from tide.config import load_vision_config
from tide.detect import Detection
from tide.drift import DriftFilter
from tide.quality import assess
from tide.static_filter import StaticFilter
from tide.track import VideoTracker

C = load_vision_config()


def _scene(seed=0, w=640, h=360):
    rng = np.random.default_rng(seed)
    img = np.full((h, w, 3), 110, np.uint8)
    for _ in range(80):  # rocks and texture: a clear scene has structure
        x, y = int(rng.integers(0, w)), int(rng.integers(0, h))
        cv2.circle(img, (x, y), int(rng.integers(3, 15)), tuple(int(v) for v in rng.integers(20, 230, 3)), -1)
    return img


def test_quality_tells_clear_from_murky():
    clear = _scene()
    murky = cv2.addWeighted(cv2.GaussianBlur(clear, (41, 41), 0), 0.25, np.full_like(clear, (120, 140, 110)), 0.75, 0)
    a, b = assess(clear, C.quality), assess(murky, C.quality)
    assert a.score > b.score + 20 and a.category != "obscured" and b.category == "obscured"
    assert b.degraded and b.unidentifiable and "blurred" in b.reasons


def test_static_pictures_are_skipped_but_a_small_moving_fish_is_not():
    f = StaticFilter(C.static_filter)
    scene = _scene()
    assert f.is_static(scene, 0.0) is False  # first picture: always searched
    assert f.is_static(scene.copy(), 0.2) is True  # identical: reuse the boxes
    moved = scene.copy()
    cv2.ellipse(moved, (320, 180), (14, 5), 0, 0, 360, (40, 40, 40), -1)  # a small fish appears
    assert f.is_static(moved, 0.4) is False
    assert f.is_static(moved.copy(), 3.0) is False  # long static run: searched again periodically


def test_static_filter_off_searches_everything():
    f = StaticFilter(replace(C.static_filter, enabled=False))
    scene = _scene()
    assert [f.is_static(scene, t) for t in (0, 0.2, 0.4)] == [False, False, False]


def test_drift_flags_a_track_that_moves_with_the_water_only():
    d = DriftFilter(C.drift)
    base = _scene(1, 640, 360)
    for i in range(6):  # the whole scene (water + debris) shifts right; the fish swims down
        img = np.roll(base, 6 * i, axis=1)
        debris = (100 + 6 * i, 100, 130 + 6 * i, 120)
        fish = (400, 60 + 15 * i, 440, 80 + 15 * i)
        d.add(img, {"debris": debris, "fish": fish})
    assert d.drifting() == {"debris"}


def test_ocsort_is_a_tracker_option():
    tr = VideoTracker("v", C.track, 5, tracker="ocsort")
    assert tr.name == "ocsort"
    seen = []
    for k in range(8):
        x = 10 + 6 * k
        seen += tr.update([Detection(k, k / 5, (x, 40, x + 30, 70), "fish", 0.9, None)])
    assert len({d.track_id for d in seen}) == 1
