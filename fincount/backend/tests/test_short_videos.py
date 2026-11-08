"""Videos shorter than the protocol window (window.allow_short_videos: true, the default).

They get a SHORTER window over the usable clip, flagged as not comparable with full windows; a
person still confirms it before anything is counted.
"""
from dataclasses import replace

import pytest

from aquavision.config import load_app_config, load_protocol_config
from aquavision.protocol import WindowError, propose_window, validate_window

PROTOCOL = load_protocol_config()
APP = load_app_config()
W = PROTOCOL.window


def test_short_video_gets_a_shorter_window_without_the_trims(synthetic_video):  # 3 min: 60 + 60 s trims leave 1 min
    p = propose_window(synthetic_video, PROTOCOL, APP)
    assert (p.start_s, p.end_s, p.too_short, p.short) == (60, 120, False, True)
    assert "Shorter than the protocol window" in p.reason and "aren't comparable" in p.reason


def test_very_short_clip_uses_the_whole_video(tmp_path):
    from video_fixture import make_video
    clip = make_video(tmp_path / "clip.mp4", seconds=8, fps=10)
    p = propose_window(clip, PROTOCOL, APP)
    assert (p.start_s, p.short) == (0, True) and p.end_s == pytest.approx(8, abs=0.2)
    assert "whole video" in p.reason


def test_short_window_rules():
    validate_window(0, 8, 8.2, 25, W)  # any part of a short video
    with pytest.raises(WindowError, match="inside the video"):
        validate_window(0, 20, 8.2, 25, W)
    with pytest.raises(WindowError, match="end after it starts"):
        validate_window(5, 5, 8.2, 25, W)
    with pytest.raises(WindowError, match="exactly 15:00.0"):  # long videos keep the full protocol rules
        validate_window(60, 300, 1800, 25, W)


def test_strict_setting_still_flags_short_videos(synthetic_video):
    strict = replace(PROTOCOL, window=replace(W, allow_short_videos=False))
    assert propose_window(synthetic_video, strict, APP).too_short is True


def test_short_video_is_counted_after_confirmation(tmp_path, monkeypatch):
    """Through the API with the test models: an 8 s clip is proposed, confirmed and counted."""
    import importlib
    import time
    from urllib.parse import quote

    from fastapi.testclient import TestClient

    from aquavision.config import load_vision_config
    from fincount_api import pipeline
    from test_vision import FakeDetector, FakeEncoder
    from video_fixture import make_video
    monkeypatch.setenv("FINCOUNT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("FINCOUNT_TOKEN", "")
    import fincount_api.main as main
    importlib.reload(main)
    pipeline.set_vision(pipeline.Vision(load_vision_config(), detector=FakeDetector(), encoder=FakeEncoder()))
    client = TestClient(main.app)
    client.post("/people", json={"name": "Ana"})
    clip = make_video(tmp_path / "T1-STAT2 clip.mp4", seconds=8, fps=10)
    job = client.post("/analyses", json={"files": [str(clip)], "ignoreSpecks": False}).json()
    for _ in range(300):
        job = client.get(f"/analyses/{job['jobId']}").json()
        if job["state"] != "running":
            break
        time.sleep(0.05)
    assert "waiting for confirmation" in job["files"][0]["detail"]
    v = client.get(f"/surveys/{job['surveyId']}/videos").json()[0]
    assert v["shortWindow"] is True and v["tooShort"] is False
    r = client.patch(f"/videos/{v['id']}", json={"windowStartS": v["proposedStartS"], "windowEndS": v["proposedEndS"]},
                     headers={"X-FinCount-User": quote("Ana")})
    assert r.status_code == 200, r.text
    for _ in range(300):
        res = client.get(f"/surveys/{job['surveyId']}/results").json()["videos"][0]
        if res["countState"] in ("done", "failed"):
            break
        time.sleep(0.05)
    assert res["countState"] == "done" and res["shortWindow"] is True
    # Points spread across the 8 s clip (every ~2 s, each in the middle of its slice).
    assert [p["timestampS"] for p in res["points"]] == [1, 3, 5, 7]
    # One square at every point (two at 7 s: it jumps across the picture inside the ±0.5 s window there).
    assert [p["totalFish"] for p in res["points"]][:3] == [1, 1, 1] and 1 <= res["meanCount"] <= 1.25


# ── small fish: stationary objects, speck size, tiled search ──

def test_objects_that_never_move_need_a_person():
    from aquavision.config import load_vision_config
    from aquavision.count import Sighting, TrackLabel, count_point
    v = load_vision_config()
    pole = [Sighting("pole", t / 5, 0.9, (50.0, 30.0, 3.0, 1.5)) for t in range(25, 76)]  # 5–15 s, never moves
    fish = [Sighting("fish", t / 5, 0.9, (10.0 + t * 0.4, 50.0, 3.0, 1.0)) for t in range(25, 76)]  # swims
    c = count_point("v", 1, 10.0, pole + fish, {}, 0.5, PROTOCOL, [], v.clarity, None, v.stationary)
    assert (c.total_fish, c.stationary, c.needs_review) == (1, 1, True) and "didn't move" in c.notes
    # A person's label wins: a resting flounder they confirmed is counted.
    c = count_point("v", 1, 10.0, pole, {"pole": TrackLabel("fish", "flounder", True)}, 0.5, PROTOCOL, [],
                    v.clarity, None, v.stationary)
    assert c.total_fish == 1 and c.stationary == 0


def test_speck_size_keeps_small_fish():
    from aquavision.config import load_vision_config
    pct = load_vision_config().detect.speck_max_area_pct
    small_fish = 100 * (60 * 20) / (1920 * 1080)  # 0.058 % of the picture
    speck = 100 * (8 * 8) / (1920 * 1080)  # 0.003 %
    assert speck < pct < small_fish


def test_tiled_search_finds_small_things_and_merges_overlaps():
    import numpy as np

    from aquavision.config import load_vision_config
    from aquavision.detect import CfdDetector, Detection

    class Stub(CfdDetector):
        """TEST ONLY: 'sees' the white square only when it fills at least 1.5 % of the picture's width."""
        def load(self):
            return self

        def detect(self, image, frame_idx=0, t_s=0.0, enhance=False):
            ys, xs = np.where(image[..., 0] > 200)
            if not len(xs) or (xs.max() - xs.min()) / image.shape[1] < 0.015:
                return []
            return [Detection(frame_idx, t_s, (float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())),
                              "fish", 0.8, None)]

    img = np.zeros((2160, 3840, 3), np.uint8)
    img[500:520, 600:640] = 255  # 40×20 px, inside the top-left tile only
    det = Stub(load_vision_config().detect)
    assert det.detect(img) == []  # too small in the whole picture
    found = det.detect_tiled(img, 2)
    assert len(found) == 1 and found[0].box == (600.0, 500.0, 639.0, 519.0)


def test_short_window_points_are_spread():
    from aquavision.protocol import short_window_timestamps
    sub = PROTOCOL.subsample
    assert short_window_timestamps(0, 8, sub, W.length_s) == [1, 3, 5, 7]
    assert short_window_timestamps(0, 1.5, sub, W.length_s) == [0.75]  # always at least one point
    assert len(short_window_timestamps(60, 120, sub, W.length_s)) == 15  # never more than a full window (15)
