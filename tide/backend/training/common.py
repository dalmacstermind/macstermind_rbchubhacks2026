"""Shared helpers for YOLOX fine-tuning. Developer tooling: the app never imports this package."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np
import yaml

HERE = Path(__file__).resolve().parent
THIRD_PARTY = HERE / "third_party"
YOLOX_SRC = THIRD_PARTY / "YOLOX"
DEPS = THIRD_PARTY / "deps"
WEIGHTS = THIRD_PARTY / "weights"

# depth, width of the official YOLOX sizes
SIZES = {"s": (0.33, 0.50), "m": (0.67, 0.75)}


def load_settings(path: Path | None = None) -> dict:
    with open(path or HERE / "training.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def use_yolox() -> None:
    """Make the pinned YOLOX source and its training-only packages importable.

    DEPS goes last so the app environment's own numpy and torch are always the ones used.
    """
    if not (YOLOX_SRC / "yolox").is_dir():
        sys.exit("YOLOX isn't set up yet. Run: python -m training.setup_yolox")
    for p in (str(YOLOX_SRC),):
        if p not in sys.path:
            sys.path.insert(0, p)
    if str(DEPS) not in sys.path:
        sys.path.append(str(DEPS))


def find_dots(img: np.ndarray, max_y_frac: float = 1.0) -> list[tuple[float, float]]:
    """Centres of the tiny black dots staff place on each fish in gridded screenshots."""
    b, g, r = [c.astype(int) for c in cv2.split(img)]
    dark = ((r < 30) & (g < 30) & (b < 30)).astype(np.uint8)
    n, _, stats, centres = cv2.connectedComponentsWithStats(dark, connectivity=8)
    limit = img.shape[0] * max_y_frac
    out = []
    for k in range(1, n):
        _, _, w, h, area = stats[k]
        if 2 <= area <= 25 and w <= 7 and h <= 7 and centres[k][1] < limit:
            out.append((float(centres[k][0]), float(centres[k][1])))
    return out


def tile_origins(length: int, size: int, overlap: int) -> list[int]:
    """Start positions of overlapping tiles covering `length`; the last tile ends exactly at the edge."""
    if length <= size:
        return [0]
    step = size - overlap
    starts = list(range(0, length - size, step))
    starts.append(length - size)
    return starts


def clip_box_to_tile(box, x0: int, y0: int, size: int, min_visible: float):
    """COCO box (x, y, w, h) in tile coordinates, or None if too little of it is inside the tile."""
    x, y, w, h = box
    x1, y1 = max(x, x0), max(y, y0)
    x2, y2 = min(x + w, x0 + size), min(y + h, y0 + size)
    if x2 <= x1 or y2 <= y1 or (x2 - x1) * (y2 - y1) < min_visible * w * h:
        return None
    return [x1 - x0, y1 - y0, x2 - x1, y2 - y1]


def assign_splits(videos: list[str], val_fraction: float, test_videos: list[str]) -> dict[str, list[str]]:
    """Split by VIDEO, never by frame: consecutive frames are near-identical (CLAUDE.md, Data rules)."""
    test = sorted(set(test_videos))
    missing = [v for v in test if v not in videos]
    if missing:
        raise ValueError(f"These test videos aren't in the labels: {', '.join(missing)}")
    rest = sorted(v for v in set(videos) if v not in test)
    if len(rest) < 2:
        raise ValueError(f"Need at least 2 labelled videos besides the test videos, found {len(rest)}. "
                         "Frames from one video can't be used for both training and validation.")
    n_val = max(1, round(len(rest) * val_fraction))
    return {"train": rest[:-n_val], "val": rest[-n_val:], "test": test}


def box_distance(p, box) -> float:
    """Distance from a point to a box (x1, y1, x2, y2); 0 if inside."""
    dx = max(box[0] - p[0], 0.0, p[0] - box[2])
    dy = max(box[1] - p[1], 0.0, p[1] - box[3])
    return float(np.hypot(dx, dy))


def match_dots(points, boxes, radius: float) -> tuple[int, int]:
    """One box per dot, closest pairs first. Returns (dots found, boxes left over)."""
    pairs = sorted((box_distance(p, b), i, j) for i, p in enumerate(points) for j, b in enumerate(boxes))
    used_dots: set[int] = set()
    used_boxes: set[int] = set()
    for dist, i, j in pairs:
        if dist > radius:
            break
        if i not in used_dots and j not in used_boxes:
            used_dots.add(i)
            used_boxes.add(j)
    return len(used_dots), len(boxes) - len(used_boxes)


def read_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)
