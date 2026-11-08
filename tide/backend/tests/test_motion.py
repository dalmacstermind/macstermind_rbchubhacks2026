"""Motion detection (tide/motion.py) on synthetic pictures from a stationary camera."""
from dataclasses import replace

import numpy as np

from tide.config import load_vision_config
from tide.motion import find_moving_objects

CFG = replace(load_vision_config().motion, work_width=320)


def _clip(n=20, fish=True, still=True, pan=False, cloud=False, seed=0):
    rng = np.random.default_rng(seed)
    base = rng.normal(120, 3, (180, 320)).astype(np.float32)
    base[::20, :] -= 30  # some texture (seabed lines), so a camera pan is visible
    frames = []
    for i in range(n):
        g = base + rng.normal(0, 2, base.shape).astype(np.float32)
        if fish:  # a faint fish swimming left to right
            x = 20 + 8 * i
            g[90:96, x:x + 14] -= 25
        if still:  # a pole marking: dark but never moving
            g[40:44, 200:215] -= 40
        if pan:  # the camera turns: everything shifts a few pixels per picture
            g = np.roll(g, 4 * i, axis=1)
        if cloud and i % 2:  # a sediment cloud brightens most of the picture
            g[:, :250] += 40
        frames.append(g)
    return frames


def test_a_swimming_fish_becomes_one_track():
    r = find_moving_objects(_clip(), CFG)
    tracks = {b.track for b in r.boxes}
    assert len(tracks) == 1 and len(r.boxes) >= CFG.min_frames
    assert all(85 <= (b.box[1] + b.box[3]) / 2 <= 100 for b in r.boxes)  # on the fish's row, not the pole


def test_things_that_do_not_move_are_ignored():
    assert find_moving_objects(_clip(fish=False), CFG).boxes == []


def test_camera_moving_or_sediment_is_skipped_with_a_reason():
    r = find_moving_objects(_clip(pan=True), CFG)
    assert r.boxes == [] and "camera moved" in r.skipped_reason
    r = find_moving_objects(_clip(cloud=True), CFG)
    assert r.boxes == [] and "sediment" in r.skipped_reason


def test_off_and_too_few_pictures_do_nothing():
    assert find_moving_objects(_clip(), replace(CFG, enabled=False)).boxes == []
    assert find_moving_objects(_clip(n=3), CFG).boxes == []
