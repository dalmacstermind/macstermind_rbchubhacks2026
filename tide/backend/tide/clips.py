"""Save each subsample point's context clip (point ± subsample.context_s) to the data folder.

Clips are cut with the bundled FFmpeg (clips.ffmpeg_path), re-encoded so they start on the right
frame and play in the app's video player. If FFmpeg is missing or fails, the clip is written with
OpenCV instead. The log always says which was used.
"""
import logging
import subprocess
from pathlib import Path

import cv2

from .config import ClipsConfig
from .frames import iter_frames, probe_video

log = logging.getLogger(__name__)


class ClipError(RuntimeError):
    """A context clip couldn't be saved. The message is plain English and is shown to staff."""


def save_clip(src: Path, start_s: float, end_s: float, out_path: Path, cfg: ClipsConfig,
              *, preroll_s: float) -> str:
    """Write src[start_s, end_s] to out_path. Returns "ffmpeg" or "opencv" (whichever wrote it)."""
    if end_s <= start_s:
        raise ValueError(f"Clip ends ({end_s} s) before it starts ({start_s} s).")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # Write to a temporary name first so a half-written clip never looks finished.
    partial = out_path.with_name(f"{out_path.stem}.partial{out_path.suffix}")
    try:
        method = "opencv"
        if cfg.ffmpeg_path is None:
            log.info("FFmpeg not configured; writing %s with OpenCV", out_path.name)
        elif not cfg.ffmpeg_path.is_file():
            log.warning("FFmpeg not found at %s; writing %s with OpenCV", cfg.ffmpeg_path, out_path.name)
        else:
            try:
                _cut_with_ffmpeg(src, start_s, end_s, partial, cfg)
                method = "ffmpeg"
            except (OSError, subprocess.SubprocessError) as e:
                log.warning("FFmpeg failed for %s (%s); writing it with OpenCV", out_path.name, _reason(e))
        if method == "opencv":
            _write_with_opencv(src, start_s, end_s, partial, cfg.opencv_fourcc, preroll_s)
        partial.replace(out_path)
    finally:
        partial.unlink(missing_ok=True)
    log.info("Saved clip %s (%.2f–%.2f s of %s) with %s", out_path.name, start_s, end_s, src.name, method)
    return method


def ffmpeg_command(ffmpeg: Path, src: Path, start_s: float, end_s: float, out_path: Path, codec: str) -> list[str]:
    """-ss before -i seeks fast; re-encoding (not -c copy) makes the clip start on the exact frame."""
    cmd = [str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
           "-ss", f"{start_s:.3f}", "-i", str(src), "-t", f"{end_s - start_s:.3f}",
           "-map", "0:v:0", "-c:v", codec]
    if codec == "libx264":
        cmd += ["-preset", "veryfast", "-crf", "20"]
    return cmd + ["-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", str(out_path)]


def _cut_with_ffmpeg(src: Path, start_s: float, end_s: float, out_path: Path, cfg: ClipsConfig) -> None:
    assert cfg.ffmpeg_path is not None
    subprocess.run(
        ffmpeg_command(cfg.ffmpeg_path, src, start_s, end_s, out_path, cfg.ffmpeg_codec),
        check=True, capture_output=True, timeout=600,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),  # no console flash in the packaged app
    )
    if not out_path.is_file() or out_path.stat().st_size == 0:
        raise subprocess.SubprocessError("FFmpeg finished but wrote no clip")


def _write_with_opencv(src: Path, start_s: float, end_s: float, out_path: Path, fourcc: str,
                       preroll_s: float) -> None:
    info = probe_video(src)
    writer = cv2.VideoWriter(str(out_path), cv2.VideoWriter_fourcc(*fourcc), info.fps, (info.width, info.height))
    if not writer.isOpened():
        raise ClipError(f"Couldn't create the clip file {out_path.name} (codec {fourcc}).")
    try:
        for frame in iter_frames(src, src.stem, start_s, end_s, preroll_s=preroll_s):
            writer.write(frame.image)
    finally:
        writer.release()


def _reason(e: Exception) -> str:
    if isinstance(e, subprocess.CalledProcessError) and e.stderr:
        return e.stderr.decode(errors="replace").strip().splitlines()[-1]
    return str(e) or e.__class__.__name__
