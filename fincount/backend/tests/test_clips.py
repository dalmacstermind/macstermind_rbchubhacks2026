import logging
import shutil
import subprocess
from pathlib import Path

import pytest

from aquavision import clips
from aquavision.clips import ffmpeg_command, save_clip
from aquavision.config import ClipsConfig
from aquavision.frames import iter_frames, probe_video
from video_fixture import decode_index

OPENCV_ONLY = ClipsConfig(ffmpeg_path=None, ffmpeg_codec="libx264", opencv_fourcc="mp4v")


def first_frame_idx(path: Path) -> int:
    return decode_index(next(iter_frames(path, "clip", 0, 0.05, preroll_s=0)).image)


def test_opencv_clip_has_the_right_frames(synthetic_video, tmp_path, caplog):
    out = tmp_path / "point_01.mp4"
    with caplog.at_level(logging.INFO):
        assert save_clip(synthetic_video, 55, 65, out, OPENCV_ONLY, preroll_s=1.0) == "opencv"
    assert probe_video(out).frame_count == 101
    assert first_frame_idx(out) == 550
    assert "FFmpeg not configured" in caplog.text and "with opencv" in caplog.text
    assert [p.name for p in tmp_path.iterdir()] == ["point_01.mp4"]  # no leftover partial file


def test_missing_ffmpeg_falls_back_to_opencv(synthetic_video, tmp_path, caplog):
    cfg = ClipsConfig(ffmpeg_path=tmp_path / "bin" / "ffmpeg.exe", ffmpeg_codec="libx264", opencv_fourcc="mp4v")
    with caplog.at_level(logging.WARNING):
        assert save_clip(synthetic_video, 10, 12, tmp_path / "c.mp4", cfg, preroll_s=1.0) == "opencv"
    assert "FFmpeg not found" in caplog.text


def test_ffmpeg_command_is_frame_accurate_and_playable():
    cmd = ffmpeg_command(Path("ffmpeg.exe"), Path("in.mp4"), 55, 65, Path("out.mp4"), "libx264")
    assert cmd.index("-ss") < cmd.index("-i")
    assert cmd[cmd.index("-ss") + 1] == "55.000" and cmd[cmd.index("-t") + 1] == "10.000"
    assert cmd[cmd.index("-c:v") + 1] == "libx264"
    assert "copy" not in cmd  # re-encode, so the clip starts on the exact frame
    assert {"-an", "+faststart", "yuv420p"} <= set(cmd)
    assert cmd[-1] == "out.mp4"


def fake_ffmpeg(tmp_path: Path) -> ClipsConfig:
    exe = tmp_path / "ffmpeg.exe"
    exe.write_bytes(b"")
    return ClipsConfig(ffmpeg_path=exe, ffmpeg_codec="libx264", opencv_fourcc="mp4v")


def test_uses_ffmpeg_when_available(synthetic_video, tmp_path, monkeypatch):
    calls = []

    def run(cmd, **kwargs):
        calls.append(cmd)
        Path(cmd[-1]).write_bytes(b"clip")  # pretend FFmpeg wrote the clip
        return subprocess.CompletedProcess(cmd, 0)

    monkeypatch.setattr(clips.subprocess, "run", run)
    out = tmp_path / "clips" / "point_01.mp4"
    assert save_clip(synthetic_video, 55, 65, out, fake_ffmpeg(tmp_path), preroll_s=1.0) == "ffmpeg"
    assert out.read_bytes() == b"clip"
    assert calls[0][calls[0].index("-i") + 1] == str(synthetic_video)


def test_ffmpeg_failure_falls_back_to_opencv(synthetic_video, tmp_path, monkeypatch, caplog):
    def run(cmd, **kwargs):
        raise subprocess.CalledProcessError(1, cmd, stderr=b"Unknown encoder 'libx264'")

    monkeypatch.setattr(clips.subprocess, "run", run)
    with caplog.at_level(logging.WARNING):
        method = save_clip(synthetic_video, 55, 65, tmp_path / "c.mp4", fake_ffmpeg(tmp_path), preroll_s=1.0)
    assert method == "opencv"
    assert "Unknown encoder 'libx264'" in caplog.text
    assert first_frame_idx(tmp_path / "c.mp4") == 550


def test_backwards_clip_is_an_error(synthetic_video, tmp_path):
    with pytest.raises(ValueError):
        save_clip(synthetic_video, 10, 5, tmp_path / "c.mp4", OPENCV_ONLY, preroll_s=1.0)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="FFmpeg is not installed on this machine")
def test_real_ffmpeg_clip(synthetic_video, tmp_path):
    cfg = ClipsConfig(ffmpeg_path=Path(shutil.which("ffmpeg")), ffmpeg_codec="libx264", opencv_fourcc="mp4v")
    out = tmp_path / "point_01.mp4"
    assert save_clip(synthetic_video, 55, 65, out, cfg, preroll_s=1.0) == "ffmpeg"
    assert abs(probe_video(out).duration_s - 10) < 0.2
    assert first_frame_idx(out) == 550
