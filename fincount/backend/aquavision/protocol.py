"""Subsample points and context clips (Coastal Action FFH protocol).

Inside the confirmed analysis window, a point is placed every subsample.interval_s seconds
(default 60 s -> 15 points in a 15 min window), numbered 1..N. Around each point, the context
clip covers ±subsample.context_s seconds (default ±5 s) and is saved to the data folder; the
frames used for analysis are only read into memory.
"""
import logging
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from .clips import save_clip
from .config import AppConfig, ProtocolConfig, SubsampleConfig
from .frames import Frame, iter_frames, iter_sampled_frames, probe_video

log = logging.getLogger(__name__)


class WindowError(ValueError):
    """The analysis window doesn't fit the video. The message is plain English and is shown to staff."""


@dataclass
class SubsamplePoint:
    video_id: str
    point_no: int          # 1..N
    timestamp_s: float     # time of the point within the video
    clip_path: Path        # context clip (point ± context_s)


def subsample_timestamps(window_start_s: float, window_end_s: float, cfg: SubsampleConfig) -> list[float]:
    """Protocol rule: one point every interval_s inside the window, the first offset_s after its start.

    Point k is at window_start + offset + (k-1)·interval, for every k before window_end.
    Example: window 60–960 s, interval 60 s, offset 0 -> 60, 120, …, 900 s (15 points).
    """
    if window_start_s < 0 or window_end_s <= window_start_s:
        raise WindowError(f"The analysis window {window_start_s}–{window_end_s} s is not a valid time range.")
    first = window_start_s + cfg.first_point_offset_s
    times = []
    k = 0
    while (t := first + k * cfg.interval_s) < window_end_s - 1e-9:  # multiply, don't add: no drift
        times.append(round(t, 3))
        k += 1
    return times


def context_range(timestamp_s: float, context_s: float, duration_s: float) -> tuple[float, float]:
    """Protocol rule: context viewed around a point is ±context_s, clipped to the start and end of the video."""
    if not 0 <= timestamp_s <= duration_s:
        raise WindowError(f"Point at {timestamp_s} s is outside the video (0–{duration_s:.1f} s).")
    return max(0.0, timestamp_s - context_s), min(duration_s, timestamp_s + context_s)


def plan_subsample_points(video_id: str, window_start_s: float, window_end_s: float, cfg: SubsampleConfig,
                          clip_dir: Path) -> list[SubsamplePoint]:
    """The points for one video, with where each clip will be saved. Reads no files."""
    times = subsample_timestamps(window_start_s, window_end_s, cfg)
    width = max(2, len(str(len(times))))
    return [SubsamplePoint(video_id, n, t, clip_dir / f"point_{n:0{width}d}.mp4") for n, t in enumerate(times, 1)]


def create_subsample_points(video_path: Path, video_id: str, window_start_s: float, window_end_s: float,
                            protocol: ProtocolConfig, app: AppConfig, clip_dir: Path) -> list[SubsamplePoint]:
    """Plan the points for the confirmed analysis window and save each point's context clip."""
    info = probe_video(video_path)
    if window_end_s > info.duration_s + 1 / info.fps:
        raise WindowError(f"The analysis window ends at {_mmss(window_end_s)}, but {video_path.name} is only "
                          f"{_mmss(info.duration_s)} long.")
    points = plan_subsample_points(video_id, window_start_s, window_end_s, protocol.subsample, clip_dir)
    methods = set()
    for p in points:
        start, end = context_range(p.timestamp_s, protocol.subsample.context_s, info.duration_s)
        methods.add(save_clip(video_path, start, end, p.clip_path, app.clips, preroll_s=app.frames.seek_preroll_s))
    log.info("%s: %d subsample points, context clips written with %s", video_id, len(points),
             " and ".join(sorted(methods)) or "nothing")
    return points


def point_frames(video_path: Path, point: SubsamplePoint, protocol: ProtocolConfig,
                 app: AppConfig) -> Iterator[Frame]:
    """Every frame in the point's ±context_s range, in memory only."""
    c = protocol.subsample.context_s
    return iter_frames(video_path, point.video_id, point.timestamp_s - c, point.timestamp_s + c,
                       preroll_s=app.frames.seek_preroll_s)


def richness_scan_frames(video_path: Path, video_id: str, window_start_s: float, window_end_s: float,
                         protocol: ProtocolConfig, app: AppConfig) -> Iterator[Frame]:
    """Sparse full-window scan at richness.scan_fps, for species richness (not only the points)."""
    return iter_sampled_frames(video_path, video_id, window_start_s, window_end_s, protocol.richness.scan_fps,
                               preroll_s=app.frames.seek_preroll_s)


def _mmss(seconds: float) -> str:
    return f"{int(seconds // 60):02d}:{seconds % 60:04.1f}"
