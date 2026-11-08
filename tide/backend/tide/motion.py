"""Motion detection: fish the detector misses, found because they move (stationary RUV cameras).

The fish detector recognises fish by their shape. In murky survey footage many fish are faint grey
streaks a few pixels long, and it misses most of them. But the camera doesn't move: the water, the
seabed and the pole stay still, so anything that moves against them is very likely a fish.

For one subsample point's context clip:
  1. background = the median of the clip's pictures (what doesn't move);
  2. foreground = pixels that differ from it by more than `threshold_sigma` × their usual noise;
  3. blobs of a fish-like size are linked from picture to picture into tracks;
  4. a track that is seen in at least `min_frames` pictures and travels at least `min_travel_px`
     becomes a candidate fish (seabed flicker and noise don't travel).

Candidates get confidence `motion.confidence` (app.yaml), below the survey's certainty threshold by
default, so they are NOT counted until a person confirms them (CLAUDE.md, conservative counting).
If the whole picture changes (the camera moved, or sediment swirled), no candidates are made for
that clip and a note says so. Settings: app.yaml `motion`. Distances are in pixels of a picture
`work_width` wide.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .config import MotionConfig


@dataclass
class MotionBox:
    frame_index: int  # index into the pictures given to find_moving_objects
    track: int
    box: tuple[float, float, float, float]  # x1, y1, x2, y2 in the work picture's pixels


@dataclass
class MotionResult:
    boxes: list[MotionBox]
    skipped_reason: str = ""  # e.g. the camera moved


def small_grey(image_bgr: np.ndarray, width: int) -> np.ndarray:
    h, w = image_bgr.shape[:2]
    if w != width:
        image_bgr = cv2.resize(image_bgr, (width, round(h * width / w)), interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)


def _camera_moved(stack: np.ndarray, max_shift_px: float = 1.5) -> bool:
    """True when the whole picture shifts between pictures (the camera was bumped or panned)."""
    shifts = []
    for a, b in zip(stack[:-1], stack[1:]):
        (dx, dy), _ = cv2.phaseCorrelate(a, b)
        shifts.append(float(np.hypot(dx, dy)))
    return bool(shifts) and float(np.median(shifts)) > max_shift_px


def find_moving_objects(greys: list[np.ndarray], cfg: MotionConfig) -> MotionResult:
    """Moving fish-like objects in a clip from a stationary camera (greys: small_grey pictures, in time order)."""
    if not cfg.enabled or len(greys) < max(5, cfg.min_frames):
        return MotionResult([])
    stack = np.stack(greys)
    if _camera_moved(stack):
        return MotionResult([], "The camera moved during this clip, so no moving fish were looked for here.")
    bg = np.median(stack, axis=0)
    noise = np.median(np.abs(stack - bg), axis=0) * 1.4826 + 1.0  # robust per-pixel noise
    blobs: list[list[tuple[np.ndarray, tuple[int, int, int, int]]]] = []
    moving_share = []
    for g in stack:
        mask = (np.abs(g - bg) / noise > cfg.threshold_sigma).astype(np.uint8)
        moving_share.append(float((np.abs(g - bg) > 20).mean()))  # big brightness changes (sediment cloud)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
        mask = cv2.dilate(mask, np.ones((3, 3), np.uint8))
        n, _, stats, cents = cv2.connectedComponentsWithStats(mask)
        blobs.append([(cents[k], tuple(int(v) for v in stats[k][:4])) for k in range(1, n)
                      if cfg.min_area_px <= stats[k][4] <= cfg.max_area_px and max(stats[k][2], stats[k][3]) >= 8])
    if float(np.median(moving_share)) > cfg.max_moving_fraction:
        return MotionResult([], "Much of the picture changed (sediment or the camera moved), so no moving fish "
                                "were looked for here.")

    # Link each blob to the nearest track end seen 1–2 pictures earlier (within link_px).
    tracks: list[list[tuple[int, np.ndarray, tuple[int, int, int, int]]]] = []
    for i, frame_blobs in enumerate(blobs):
        taken: set[int] = set()
        for c, (x, y, w, h) in frame_blobs:
            best, best_d = None, cfg.link_px
            for t_idx, t in enumerate(tracks):
                if t_idx in taken or i - t[-1][0] not in (1, 2):
                    continue
                d = float(np.hypot(*(c - t[-1][1])))
                if d < best_d:
                    best, best_d = t_idx, d
            if best is None:
                tracks.append([(i, c, (x, y, w, h))])
            else:
                tracks[best].append((i, c, (x, y, w, h)))
                taken.add(best)

    out: list[MotionBox] = []
    for t_no, t in enumerate(tracks):
        if len(t) < cfg.min_frames:
            continue
        travel = float(np.hypot(*(t[-1][1] - t[0][1])))
        if travel < cfg.min_travel_px:
            continue
        for i, _, (x, y, w, h) in t:
            pad = 3  # the moving part is often only the fish's flank: give the box a little room
            out.append(MotionBox(i, t_no, (float(x - pad), float(y - pad), float(x + w + pad), float(y + h + pad))))
    return MotionResult(out)
