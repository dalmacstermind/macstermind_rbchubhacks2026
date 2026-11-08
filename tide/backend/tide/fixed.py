"""Things fixed in view for the whole video: the survey pole and its markings, rope, rocks.

The fish detector sometimes boxes the pole's coloured bands (they are fish-sized and fish-shaped)
with high confidence, in every picture. A fish doesn't stay in exactly the same place for most of a
video, so a box found in the same place in at least `min_share` of all the pictures searched in the
video is fixed structure: it and every box on it are removed before counting and species ID.
Settings: app.yaml `fixed_structure`. Boxes are in pixels of the pictures staff see.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .config import FixedStructureConfig
from .detect import Detection, box_iou

Box = tuple[float, float, float, float]


@dataclass
class _Place:
    boxes: list[Box] = field(default_factory=list)
    frames: set[int] = field(default_factory=set)

    @property
    def box(self) -> Box:
        return tuple(float(v) for v in np.median(np.asarray(self.boxes), axis=0))  # type: ignore[return-value]


def find_fixed(searched: dict[int, list[Detection]], width: float, cfg: FixedStructureConfig) -> list[Box]:
    """Places boxed in most of the searched pictures (frame number -> the detector's boxes there)."""
    if not cfg.enabled or not searched:
        return []
    places: list[_Place] = []
    for frame_idx in sorted(searched):
        for d in searched[frame_idx]:
            best, best_iou = None, cfg.match_iou
            for pl in places:
                iou = box_iou(pl.boxes[-1], d.box)
                if iou >= best_iou:
                    best, best_iou = pl, iou
            if best is None:
                best = _Place()
                places.append(best)
            best.boxes.append(d.box)
            best.frames.add(frame_idx)
    need = max(cfg.min_pictures, cfg.min_share * len(searched))
    out = []
    for pl in places:
        if len(pl.frames) < need:
            continue
        c = np.asarray([((b[0] + b[2]) / 2, (b[1] + b[3]) / 2) for b in pl.boxes])
        # Spread of the middle 80 % of the centres: one or two stray boxes don't make a rock "move".
        spread = np.percentile(c, 90, axis=0) - np.percentile(c, 10, axis=0)
        if float(spread.max()) <= cfg.max_shift_pct / 100 * width:
            out.append(pl.box)
    return out


def on_fixed(d: Detection, fixed: list[Box], cfg: FixedStructureConfig) -> bool:
    """The box is one of the fixed places (or a small box whose centre lies on one)."""
    cx, cy = (d.box[0] + d.box[2]) / 2, (d.box[1] + d.box[3]) / 2
    for f in fixed:
        if box_iou(f, d.box) >= cfg.match_iou:
            return True
        area = (d.box[2] - d.box[0]) * (d.box[3] - d.box[1])
        if f[0] <= cx <= f[2] and f[1] <= cy <= f[3] and area <= (f[2] - f[0]) * (f[3] - f[1]):
            return True
    return False
