"""Read frames from a video on this computer with OpenCV. Nothing is uploaded or sent anywhere.

Only the frames that are needed are read: a time range (a point's ±context_s) or a sparse scan
(species richness at richness.scan_fps). Frames stay in memory; nothing is written to disk here.

Seeking in long camera videos can land a few frames off, so every read seeks to a little before
the range (frames.seek_preroll_s), reads frames in order, and uses the decoder's timestamps.
"""
import logging
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import NamedTuple

import cv2
import numpy as np

log = logging.getLogger(__name__)


class VideoReadError(RuntimeError):
    """A video can't be opened or read. The message is plain English and is shown to staff."""


@dataclass(frozen=True)
class VideoInfo:
    path: Path
    fps: float
    frame_count: int
    duration_s: float
    width: int
    height: int


class Frame(NamedTuple):
    """One decoded frame, always with its source (video, frame index, time in seconds)."""

    video_id: str
    frame_idx: int
    t_s: float
    image: np.ndarray


def probe_video(path: Path) -> VideoInfo:
    """Open the video and check at least one frame can be decoded."""
    cap = _open(path)
    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if fps <= 0 or frame_count <= 0:
            raise VideoReadError(f"{path.name} doesn't look like a video (no frame rate or length).")
        if not cap.read()[0]:
            raise VideoReadError(f"{path.name} opened, but no pictures could be read from it. It may be damaged.")
        return VideoInfo(path=path, fps=fps, frame_count=frame_count, duration_s=frame_count / fps,
                         width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                         height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    finally:
        cap.release()


def iter_frames(path: Path, video_id: str, start_s: float, end_s: float, *, preroll_s: float) -> Iterator[Frame]:
    """Every frame from start_s to end_s (inclusive), in order. The range is clipped to the video."""
    yield from _decode(path, video_id, start_s, end_s, preroll_s, keep=lambda t: True)


def iter_sampled_frames(path: Path, video_id: str, start_s: float, end_s: float, fps: float,
                        *, preroll_s: float) -> Iterator[Frame]:
    """One frame every 1/fps seconds from start_s to end_s: the first frame at or after each target time.

    Used for the sparse full-window scan for species richness (richness.scan_fps).
    """
    if fps <= 0:
        raise ValueError(f"Scan rate must be more than 0 frames per second (got {fps}).")
    step = 1.0 / fps
    k = 0

    def keep(t: float) -> bool:
        nonlocal k
        if t < start_s + k * step - _EPS:
            return False
        while start_s + k * step <= t + _EPS:  # skip targets this frame already covers
            k += 1
        return True

    yield from _decode(path, video_id, start_s, end_s, preroll_s, keep)


_EPS = 1e-3  # 1 ms: timestamps from the decoder are rounded to milliseconds


def _open(path: Path) -> cv2.VideoCapture:
    if not path.is_file():
        raise VideoReadError(f"Can't find the video {path.name} at {path.parent}. Is the drive connected?")
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        cap.release()
        raise VideoReadError(f"{path.name} can't be opened. It may be damaged or not a video file.")
    return cap


def _decode(path: Path, video_id: str, start_s: float, end_s: float, preroll_s: float,
            keep: Callable[[float], bool]) -> Iterator[Frame]:
    if end_s < start_s:
        raise ValueError(f"Time range ends ({end_s} s) before it starts ({start_s} s).")
    info = probe_video(path)
    last_frame_t = (info.frame_count - 1) / info.fps
    start, end = max(0.0, start_s), min(end_s, last_frame_t)
    if start > end:
        return  # the whole range is outside the video
    cap = _open(path)
    try:
        cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, start - preroll_s) * 1000)
        frame_s = 1.0 / info.fps
        last_t: float | None = None
        yielded = 0
        # grab() moves to the next frame without converting it; retrieve() only for frames we keep.
        while cap.grab():
            t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
            if last_t is not None and t <= last_t:  # some files report a stuck timestamp
                t = last_t + frame_s
            last_t = t
            if t < start - _EPS:
                continue
            if t > end + _EPS:
                break
            if not keep(t):
                continue
            ok, image = cap.retrieve()
            if not ok:
                break
            yielded += 1
            yield Frame(video_id, round(t * info.fps), round(t, 3), image)
    finally:
        cap.release()
    if yielded == 0:
        raise VideoReadError(f"No pictures could be read from {path.name} between {start:.1f} s and {end:.1f} s. "
                             "The file may be damaged.")
    if last_t is not None and last_t < end - 2 * frame_s:
        log.warning("%s: reading stopped at %.2f s, before the end of the range (%.2f s); the file may be damaged",
                    path.name, last_t, end)
