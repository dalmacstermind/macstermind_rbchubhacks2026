from dataclasses import replace

import numpy as np
import pytest

from tide import protocol as protocol_module
from tide.config import load_app_config, load_protocol_config
from tide.frames import VideoReadError
from tide.protocol import WindowError, propose_window, settle_score, validate_window

PROTOCOL = load_protocol_config()
APP = load_app_config()
W = PROTOCOL.window


def test_clear_video_gets_the_default_window(clear_video):
    p = propose_window(clear_video, PROTOCOL, APP)
    assert (p.start_s, p.end_s) == (60, 960)
    assert p.settled is True and p.too_short is False
    assert "settled at 01:00" in p.reason
    assert p.settle_score < W.settle_threshold


def test_clear_video_check_stops_early(clear_video, monkeypatch):
    """Only a few seconds near the start are read when the water is already settled."""
    real = protocol_module.iter_sampled_frames
    read = []

    def counting(*args, **kwargs):
        for frame in real(*args, **kwargs):
            read.append(frame.t_s)
            yield frame

    monkeypatch.setattr(protocol_module, "iter_sampled_frames", counting)
    propose_window(clear_video, PROTOCOL, APP)
    assert max(read) <= W.trim_start_s + W.settle_hold_s + 1


def test_two_minutes_of_sediment_suggests_a_later_start(sediment_2min_video):
    p = propose_window(sediment_2min_video, PROTOCOL, APP)
    assert 120 <= p.start_s <= 125
    assert p.end_s == p.start_s + 900
    assert p.settled is True
    assert "later start is suggested" in p.reason and "Please check" in p.reason


def test_sediment_past_the_extra_settling_time_is_flagged_unsettled(sediment_6min_video):
    p = propose_window(sediment_6min_video, PROTOCOL, APP)
    assert (p.start_s, p.end_s) == (300, 1200)  # latest allowed start: 60 s + 240 s
    assert p.settled is False
    assert "still looks unsettled at 05:00" in p.reason
    assert p.settle_score > W.settle_threshold


def test_later_start_that_would_not_fit_the_video_is_flagged(short_sediment_video):
    p = propose_window(short_sediment_video, PROTOCOL, APP)  # 18 min: latest start is 18:00 - 60 s - 15 min
    assert (p.start_s, p.end_s) == (120, 1020)
    assert p.settled is False


def test_video_shorter_than_the_protocol_is_flagged(synthetic_video):
    strict = replace(PROTOCOL, window=replace(W, allow_short_videos=False))
    p = propose_window(synthetic_video, strict, APP)
    assert p.too_short is True
    assert (p.start_s, p.end_s, p.settled) == (None, None, None)
    assert "03:00.0 long" in p.reason and "17:00.0" in p.reason and "won't be processed" in p.reason


def test_threshold_comes_from_the_config(sediment_2min_video):
    lenient = replace(PROTOCOL, window=replace(W, settle_threshold=5.0))
    assert propose_window(sediment_2min_video, lenient, APP).start_s == 60


def test_unreadable_video_is_a_clear_error(tmp_path):
    bad = tmp_path / "broken.mp4"
    bad.write_bytes(b"x" * 1000)
    with pytest.raises(VideoReadError, match="broken.mp4"):
        propose_window(bad, PROTOCOL, APP)


def test_settle_score():
    rng = np.random.default_rng(1)
    scene = rng.random((120, 160), dtype=np.float32)
    assert settle_score(scene, scene) == 0
    moved = np.roll(scene, 2, axis=1)
    murky_a = 0.4 + 0.05 * rng.random((120, 160), dtype=np.float32)
    murky_b = 0.4 + 0.05 * rng.random((120, 160), dtype=np.float32)
    assert settle_score(murky_a, murky_b) > settle_score(scene, moved)


# validate_window: a 20:12 video at 30 fps, default protocol (60 s / 900 s / 60 s, up to 240 s extra)
DURATION, FPS = 1212.0, 30.0


@pytest.mark.parametrize("start, end", [(60, 960), (252, 1152), (125.5, 1025.5), (60.02, 960.02)])
def test_valid_windows(start, end):
    validate_window(start, end, DURATION, FPS, W)


@pytest.mark.parametrize("start, end, message", [
    (30, 930, "can't start before 01:00"),
    (301, 1201, "can't start after 05:00"),
    (60, 900, "must be exactly 15:00.0 long"),
    (60, 1000, "must be exactly 15:00.0 long"),
    (100, 90, "must end after it starts"),
    (60, 60, "must end after it starts"),
])
def test_invalid_windows(start, end, message):
    with pytest.raises(WindowError, match=message):
        validate_window(start, end, DURATION, FPS, W)


def test_window_must_leave_the_last_minute_out():
    with pytest.raises(WindowError, match="must end by 17:00.0"):
        validate_window(200, 1100, 18 * 60, FPS, W)  # 18-min video: must end by 17:00
