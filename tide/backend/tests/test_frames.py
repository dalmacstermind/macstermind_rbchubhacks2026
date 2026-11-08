import pytest

from tide.frames import Frame, VideoReadError, iter_frames, iter_sampled_frames, probe_video
from video_fixture import decode_index

PREROLL = 1.0


def read(video, start, end):
    return list(iter_frames(video, "GX010021", start, end, preroll_s=PREROLL))


def test_probe(synthetic_video):
    info = probe_video(synthetic_video)
    assert (info.fps, info.frame_count, info.duration_s) == (10, 1800, 180)
    assert (info.width, info.height) == (160, 120)


def test_frames_come_back_in_order_with_their_source(synthetic_video):
    frames = read(synthetic_video, 60, 65)
    assert [f.frame_idx for f in frames] == list(range(600, 651))
    for f in frames:
        assert isinstance(f, Frame)
        assert f.video_id == "GX010021"
        assert f.t_s == pytest.approx(f.frame_idx / 10, abs=1e-3)
        assert decode_index(f.image) == f.frame_idx  # the picture really is that frame


@pytest.mark.parametrize("start", [5.0, 33.3, 97.7, 123.4, 171.9])
def test_seeking_lands_on_the_right_frame(synthetic_video, start):
    frames = read(synthetic_video, start, start + 1)
    assert frames[0].t_s >= start - 1e-3
    assert frames[0].t_s - start < 0.1  # first frame at or just after the start
    assert all(decode_index(f.image) == f.frame_idx for f in frames)


def test_range_before_the_start_is_clipped(synthetic_video):
    frames = read(synthetic_video, -3, 2)
    assert frames[0].frame_idx == 0 and frames[-1].frame_idx == 20


def test_range_past_the_end_is_clipped(synthetic_video):
    frames = read(synthetic_video, 178, 200)
    assert frames[0].frame_idx == 1780 and frames[-1].frame_idx == 1799
    assert decode_index(frames[-1].image) == 1799


def test_range_entirely_outside_the_video_gives_no_frames(synthetic_video):
    assert read(synthetic_video, 190, 200) == []


def test_backwards_range_is_an_error(synthetic_video):
    with pytest.raises(ValueError):
        read(synthetic_video, 10, 5)


def test_sampled_scan_takes_one_frame_per_step(synthetic_video):
    frames = list(iter_sampled_frames(synthetic_video, "GX010021", 10, 20, 2, preroll_s=PREROLL))
    assert [f.frame_idx for f in frames] == list(range(100, 201, 5))  # 2 fps -> every 5th frame at 10 fps
    assert all(decode_index(f.image) == f.frame_idx for f in frames)


def test_sampled_scan_faster_than_the_video_returns_each_frame_once(synthetic_video):
    frames = list(iter_sampled_frames(synthetic_video, "v", 10, 11, 25, preroll_s=PREROLL))
    assert [f.frame_idx for f in frames] == list(range(100, 111))


def test_sampled_scan_rejects_zero_rate(synthetic_video):
    with pytest.raises(ValueError):
        list(iter_sampled_frames(synthetic_video, "v", 10, 20, 0, preroll_s=PREROLL))


def test_missing_file_is_a_clear_error(tmp_path):
    with pytest.raises(VideoReadError, match="Can't find"):
        probe_video(tmp_path / "gone.mp4")


@pytest.mark.parametrize("kind", ["garbage", "empty", "truncated"])
def test_corrupt_file_is_a_clear_error_not_a_crash(tmp_path, synthetic_video, kind):
    bad = tmp_path / f"{kind}.mp4"
    if kind == "garbage":
        bad.write_bytes(bytes(range(256)) * 400)
    elif kind == "empty":
        bad.write_bytes(b"")
    else:
        data = synthetic_video.read_bytes()
        bad.write_bytes(data[: len(data) // 3])
    with pytest.raises(VideoReadError) as err:
        read(bad, 0, 5)
    assert bad.name in str(err.value)
