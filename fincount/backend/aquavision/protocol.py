"""Analysis window, subsample points and context clips (Coastal Action FFH protocol).

The analysis window is proposed by propose_window() and only used once a person confirms it
(AnalysisWindow). Inside the confirmed window, a point is placed every subsample.interval_s seconds
(default 60 s -> 15 points in a 15 min window), numbered 1..N. Around each point, the context
clip covers ±subsample.context_s seconds (default ±5 s) and is saved to the data folder; the
frames used for analysis are only read into memory.
"""
import logging
import math
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from statistics import median

import cv2
import numpy as np

from .clips import save_clip
from .config import AppConfig, ProtocolConfig, SubsampleConfig, WindowConfig
from .frames import Frame, iter_frames, iter_sampled_frames, probe_video

log = logging.getLogger(__name__)


class WindowError(ValueError):
    """The analysis window doesn't fit the video. The message is plain English and is shown to staff."""


@dataclass
class WindowProposal:
    """What the app suggests. Never used for counting until a person confirms it."""
    start_s: float | None      # None when the video is too short for the protocol
    end_s: float | None
    reason: str                # plain English, shown to staff
    settled: bool | None       # False: sediment still unsettled at the latest allowed start; None: not checked
    too_short: bool
    settle_score: float | None  # median sediment score just after the proposed start (lower = clearer)
    short: bool = False         # shorter than the protocol window (window.allow_short_videos): not comparable


@dataclass
class AnalysisWindow:
    """A window a person confirmed. Subsample points are only ever made from one of these."""
    video_id: str
    start_s: float
    end_s: float
    confirmed_by: str
    confirmed_at: datetime


def settle_score(prev_gray: np.ndarray, gray: np.ndarray) -> float:
    """Sediment score for two consecutive scan frames: frame-to-frame change ÷ image contrast.

    - change: mean absolute grey-level difference between the two frames (0–1).
    - contrast: RMS contrast of the newer frame (standard deviation of grey levels, 0–1).

    Suspended sediment makes the picture change a lot while showing little detail, so the score is
    high. A fish swimming through clear water changes part of the picture but the scene keeps its
    contrast, so the score stays low. Scores below window.settle_threshold count as settled.
    """
    change = float(np.mean(np.abs(gray - prev_gray)))
    contrast = float(np.std(gray))
    return change / max(contrast, 0.01)


def propose_window(video_path: Path, protocol: ProtocolConfig, app: AppConfig) -> WindowProposal:
    """Protocol rule: discard window.trim_start_s at the start and window.trim_end_s at the end, and
    analyse window.length_s. If sediment hasn't settled at the proposed start, suggest a later start,
    at most window.max_extra_settle_s later. Staff confirm or change the result (never automatic).

    Sediment check: read window.settle_scan_fps frames per second from the proposed start, shrunk and
    in grey. The water counts as settled from the first frame where settle_score() stays below
    window.settle_threshold for window.settle_hold_s seconds in a row (so one passing fish, or one
    clear frame in a cloud of sediment, doesn't decide it). The scan stops as soon as it's settled.
    """
    w = protocol.window
    info = probe_video(video_path)
    needed = w.trim_start_s + w.length_s + w.trim_end_s
    if info.duration_s + 1 / info.fps < needed and w.allow_short_videos:
        return _short_proposal(info.duration_s, w)
    if info.duration_s + 1 / info.fps < needed:
        return WindowProposal(None, None, f"Too short for the protocol: the video is {_mmss(info.duration_s)} long "
                              f"but needs at least {_mmss(needed)} ({w.trim_start_s:g} s + {_mmss(w.length_s)} + "
                              f"{w.trim_end_s:g} s). It won't be processed.", None, True, None)

    latest_start = min(w.trim_start_s + w.max_extra_settle_s, info.duration_s - w.trim_end_s - w.length_s)
    scores: list[tuple[float, float]] = []  # (time of the newer frame, score)
    run_start = found = first_pair_t = None
    prev = None
    for frame in iter_sampled_frames(video_path, video_path.stem, w.trim_start_s, latest_start + w.settle_hold_s,
                                     w.settle_scan_fps, preroll_s=app.frames.seek_preroll_s):
        gray = _small_gray(frame.image)
        if prev is not None:
            if first_pair_t is None:
                first_pair_t = frame.t_s  # settled from here on = settled at the default start
            score = settle_score(prev, gray)
            scores.append((frame.t_s, score))
            if score >= w.settle_threshold:
                run_start = None
            elif run_start is None:
                run_start = frame.t_s
            if run_start is not None and frame.t_s - run_start >= w.settle_hold_s - 1e-6:
                found = run_start
                break
        prev = gray

    if found is not None and found <= first_pair_t + 1e-6:
        start, settled = w.trim_start_s, True
        reason = f"Water looks settled at {_mmss(start)}."
    elif found is not None and math.ceil(found) <= latest_start:
        start, settled = float(math.ceil(found)), True
        reason = (f"Sediment until about {_mmss(start)}, so a later start is suggested. "
                  "Please check the video before confirming.")
    else:
        start, settled = latest_start, False
        reason = (f"Sediment still looks unsettled at {_mmss(start)}, the latest allowed start. "
                  "Please check the video before confirming.")
    around = [s for t, s in scores if start <= t <= start + w.settle_hold_s] or [s for _, s in scores[-4:]]
    return WindowProposal(start, start + w.length_s, reason, settled, False,
                          round(median(around), 3) if around else None)


def _short_proposal(duration_s: float, w: WindowConfig) -> WindowProposal:
    """A video shorter than the protocol needs (window.allow_short_videos): propose the usable clip.

    The start and end are still discarded when the video is long enough to keep something in between;
    otherwise the whole clip is proposed. Either way it is flagged as a shorter window: its counts are
    not comparable with full protocol windows, and a person must still confirm it.
    """
    if duration_s - w.trim_start_s - w.trim_end_s >= 1:
        start, end = w.trim_start_s, duration_s - w.trim_end_s
        how = f"the first {w.trim_start_s:g} s and last {w.trim_end_s:g} s are still left out"
    else:
        start, end = 0.0, duration_s
        how = "it's too short to leave out the start and end, so the whole video is used"
    needed = w.trim_start_s + w.length_s + w.trim_end_s
    reason = (f"Shorter than the protocol window: the video is {_mmss(duration_s)} long and the protocol needs "
              f"{_mmss(needed)}. Proposed {_mmss(start)}–{_mmss(end)} ({how}). Counts from a shorter window "
              "aren't comparable with full 15-minute windows. Check the video before confirming.")
    return WindowProposal(round(start, 3), round(end, 3), reason, None, False, None, short=True)


def validate_window(start_s: float, end_s: float, duration_s: float, fps: float, cfg: WindowConfig) -> None:
    """Protocol rules for a confirmed window. Raises WindowError with a plain-English reason."""
    tol = 1 / fps  # one frame either way
    if cfg.allow_short_videos and duration_s + tol < cfg.trim_start_s + cfg.length_s + cfg.trim_end_s:
        # A video shorter than the protocol: any part of it, at most window.length_s long.
        if end_s <= start_s:
            raise WindowError("The window must end after it starts.")
        if start_s < -tol or end_s > duration_s + tol:
            raise WindowError(f"The window must be inside the video (00:00.0–{_mmss(duration_s)}).")
        if end_s - start_s > cfg.length_s + tol:
            raise WindowError(f"The window can't be longer than {_mmss(cfg.length_s)}.")
        return
    latest = cfg.trim_start_s + cfg.max_extra_settle_s
    must_end_by = duration_s - cfg.trim_end_s
    if end_s <= start_s:
        raise WindowError("The window must end after it starts.")
    if start_s < cfg.trim_start_s - tol:
        raise WindowError(f"The window can't start before {_mmss(cfg.trim_start_s)}: "
                          f"the protocol discards the first {cfg.trim_start_s:g} s.")
    if start_s > latest + tol:
        raise WindowError(f"The window can't start after {_mmss(latest)} ({cfg.trim_start_s:g} s plus at most "
                          f"{cfg.max_extra_settle_s:g} s extra settling time).")
    if abs((end_s - start_s) - cfg.length_s) > tol:
        raise WindowError(f"The window must be exactly {_mmss(cfg.length_s)} long "
                          f"(this one is {_mmss(end_s - start_s)}).")
    if end_s > must_end_by + tol:
        raise WindowError(f"The window must end by {_mmss(must_end_by)}: the protocol discards the last "
                          f"{cfg.trim_end_s:g} s of this {_mmss(duration_s)} video.")


def _small_gray(image: np.ndarray, width: int = 160) -> np.ndarray:
    """Grey, about 160 px wide, 0–1: enough to see sediment, fast to compare."""
    h, w = image.shape[:2]
    if w > width:
        image = cv2.resize(image, (width, max(1, round(h * width / w))), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255


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


def create_subsample_points(video_path: Path, window: AnalysisWindow, protocol: ProtocolConfig, app: AppConfig,
                            clip_dir: Path) -> list[SubsamplePoint]:
    """Plan the points for the confirmed analysis window and save each point's context clip."""
    _require_confirmed(window)
    info = probe_video(video_path)
    if window.end_s > info.duration_s + 1 / info.fps:
        raise WindowError(f"The analysis window ends at {_mmss(window.end_s)}, but {video_path.name} is only "
                          f"{_mmss(info.duration_s)} long.")
    video_id = window.video_id
    points = plan_subsample_points(video_id, window.start_s, window.end_s, protocol.subsample, clip_dir)
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


def richness_scan_frames(video_path: Path, window: AnalysisWindow, protocol: ProtocolConfig,
                         app: AppConfig) -> Iterator[Frame]:
    """Sparse full-window scan at richness.scan_fps, for species richness (not only the points)."""
    _require_confirmed(window)
    return iter_sampled_frames(video_path, window.video_id, window.start_s, window.end_s,
                               protocol.richness.scan_fps, preroll_s=app.frames.seek_preroll_s)


def _require_confirmed(window: AnalysisWindow) -> None:
    if not isinstance(window, AnalysisWindow) or not window.confirmed_by.strip():
        raise WindowError("The analysis window hasn't been confirmed by a person yet.")


def _mmss(seconds: float) -> str:
    return f"{int(seconds // 60):02d}:{seconds % 60:04.1f}"
