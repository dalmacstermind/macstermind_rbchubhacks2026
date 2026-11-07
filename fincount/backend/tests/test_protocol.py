import logging
from dataclasses import replace

import pytest

from aquavision.config import ClipsConfig, load_app_config, load_protocol_config
from aquavision.frames import probe_video
from aquavision.protocol import (WindowError, context_range, create_subsample_points, plan_subsample_points,
                                 point_frames, richness_scan_frames, subsample_timestamps)
from video_fixture import decode_index

PROTOCOL = load_protocol_config()
APP = load_app_config()
NO_FFMPEG = replace(APP, clips=ClipsConfig(ffmpeg_path=None, ffmpeg_codec="libx264", opencv_fourcc="mp4v"))


def sub(**changes):
    return replace(PROTOCOL.subsample, **changes)


def test_hand_calculation_default_protocol():
    # 20-min video: trim 60 s -> window 01:00–16:00; a point every 60 s from 01:00.
    assert subsample_timestamps(60, 960, PROTOCOL.subsample) == [60.0 * k for k in range(1, 16)]


@pytest.mark.parametrize("interval, offset, expected", [
    (60, 0, [60 + 60 * k for k in range(15)]),        # 15 points: 01:00 … 15:00
    (30, 0, [60 + 30 * k for k in range(30)]),        # 30 points
    (90, 0, [60 + 90 * k for k in range(10)]),        # 10 points: 900/90, last at 14:30
    (60, 30, [90 + 60 * k for k in range(15)]),       # mid-interval: 01:30 … 15:30
    (900, 0, [60]),                                   # one point
])
def test_point_count_and_timestamps_follow_the_settings(interval, offset, expected):
    assert subsample_timestamps(60, 960, sub(interval_s=interval, first_point_offset_s=offset)) == expected


def test_points_stay_inside_a_window_that_is_not_a_whole_number_of_intervals():
    assert subsample_timestamps(60, 1000, sub(interval_s=60))[-1] == 960
    assert subsample_timestamps(0, 0.25, sub(interval_s=0.1)) == [0.0, 0.1, 0.2]  # no float drift


@pytest.mark.parametrize("start, end", [(-1, 900), (900, 60), (60, 60)])
def test_invalid_window_is_rejected(start, end):
    with pytest.raises(WindowError):
        subsample_timestamps(start, end, PROTOCOL.subsample)


@pytest.mark.parametrize("t, context, expected", [
    (60, 5, (55, 65)),
    (60, 10, (50, 70)),
    (3, 5, (0, 8)),           # near the start
    (178, 5, (173, 180)),     # near the end
    (0, 5, (0, 5)),
])
def test_context_range_is_clipped_to_the_video(t, context, expected):
    assert context_range(t, context, 180) == expected


def test_context_range_rejects_a_point_outside_the_video():
    with pytest.raises(WindowError):
        context_range(181, 5, 180)


def test_plan_numbers_points_and_names_clips(tmp_path):
    points = plan_subsample_points("GX010021", 60, 960, PROTOCOL.subsample, tmp_path)
    assert [p.point_no for p in points] == list(range(1, 16))
    assert points[6].timestamp_s == 420 and points[6].clip_path == tmp_path / "point_07.mp4"
    assert {p.video_id for p in points} == {"GX010021"}


def test_create_points_saves_one_clip_per_point(synthetic_video, tmp_path, caplog):
    protocol = replace(PROTOCOL, subsample=sub(interval_s=30))
    with caplog.at_level(logging.INFO):
        points = create_subsample_points(synthetic_video, "GX010021", 30, 150, protocol, NO_FFMPEG, tmp_path)
    assert [p.timestamp_s for p in points] == [30, 60, 90, 120]
    for p in points:
        clip = probe_video(p.clip_path)
        assert clip.frame_count == 101  # ±5 s at 10 fps, both ends included
    assert "with opencv" in caplog.text
    assert not list(tmp_path.glob("*.partial*"))


def test_clip_of_a_point_near_the_start_is_clipped(synthetic_video, tmp_path):
    protocol = replace(PROTOCOL, subsample=sub(interval_s=60))
    points = create_subsample_points(synthetic_video, "GX010021", 0, 180, protocol, NO_FFMPEG, tmp_path)
    assert [p.timestamp_s for p in points] == [0, 60, 120]
    assert probe_video(points[0].clip_path).frame_count == 51  # 0–5 s only


def test_window_longer_than_the_video_is_rejected(synthetic_video, tmp_path):
    with pytest.raises(WindowError, match="only 03:00.0 long"):
        create_subsample_points(synthetic_video, "GX010021", 60, 960, PROTOCOL, NO_FFMPEG, tmp_path)


def test_point_frames_cover_plus_minus_context_in_memory(synthetic_video, tmp_path):
    point = plan_subsample_points("GX010021", 60, 180, sub(interval_s=60), tmp_path)[0]
    frames = list(point_frames(synthetic_video, point, PROTOCOL, APP))
    assert frames[0].t_s == 55 and frames[-1].t_s == 65 and len(frames) == 101
    assert all(f.video_id == "GX010021" and decode_index(f.image) == f.frame_idx for f in frames)
    assert not list(tmp_path.iterdir())  # nothing written to disk


def test_richness_scan_reads_the_whole_window_at_scan_fps(synthetic_video):
    frames = list(richness_scan_frames(synthetic_video, "GX010021", 30, 150, PROTOCOL, APP))
    assert len(frames) == 241  # 30.0, 30.5, … 150.0
    gaps = {round(b.t_s - a.t_s, 3) for a, b in zip(frames, frames[1:])}
    assert gaps == {0.5}
