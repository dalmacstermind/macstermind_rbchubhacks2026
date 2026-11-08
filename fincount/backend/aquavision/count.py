"""Counting at subsample points, MeanCount, species richness and image counts (CLAUDE.md, Protocol rules).

Pure functions: the caller gathers sightings and labels from the database, these apply the rules.

- An organism counts at a point only if it is seen within ±count.tolerance_s of the point (never
  more than ±count.max_tolerance_s). Tracking across the point's context clip means one fish is
  counted ONCE, however many pictures it appears in.
- Fish seen only outside the tolerance window are not counted; they become a note.
- Conservative counting: a fish within the tolerance window counts only if the detector was sure
  enough (the survey's certainty threshold) or a person confirmed it. Otherwise the point needs
  review and the fish is noted, not counted.
- MeanCount = sum of per-point fish counts ÷ number of points (zero-count points included).
- Species richness = distinct species seen anywhere in the analysis window (points + the sparse
  full-window scan), counting only sure or confirmed fish.
- Fish and invertebrates are counted separately; unidentified fish go to `unknown`.
- Objects that never move during the context clip (pole markings, rocks, sometimes a resting fish)
  are not counted automatically: the point needs review (settings in app.yaml, `stationary`).
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field

from .config import ClarityConfig, ProtocolConfig, StationaryConfig

_EPS = 1e-6


@dataclass
class Sighting:
    """One detection of a tracked organism."""

    track_id: str
    t_s: float
    conf: float
    box: tuple[float, float, float, float] | None = None  # x, y, w, h in % of the picture (for stationary)


@dataclass
class TrackLabel:
    """What a tracked organism is, after staff labels (a human label always wins over the AI)."""

    kind: str  # "fish" | "invertebrate" | "not_organism"
    species: str | None  # registry species id for fish (or invertebrate species); None = unknown
    human: bool  # a person labelled or confirmed it


@dataclass
class PointCount:
    """One row per subsample point; mirrors Coastal Action's spreadsheet."""

    video_id: str
    point_no: int
    timestamp_s: float
    total_fish: int
    invertebrates: int
    per_species: dict[str, int]
    unknown: int
    species_observed: int
    visibility: str | None  # confirmed category (staff)
    clarity_index: float | None  # 0–100, median over the tolerance window
    suggested_visibility: str | None
    notes: str
    needs_review: bool
    uncertain: int = 0  # possible fish within the tolerance window, below the threshold and unconfirmed
    outside: int = 0  # fish seen in the context clip but only outside the tolerance window
    stationary: int = 0  # objects that never moved during the clip, waiting for a person (not counted)


@dataclass
class ImageCount:
    """One row per image (never part of MeanCount)."""

    file_id: str
    rel_path: str
    total_fish: int
    invertebrates: int
    per_species: dict[str, int]
    unknown: int
    notes: str
    needs_review: bool


@dataclass
class _Tally:
    total_fish: int = 0
    invertebrates: int = 0
    unknown: int = 0
    per_species: dict[str, int] = field(default_factory=dict)

    def add(self, label: TrackLabel) -> None:
        if label.kind == "invertebrate":
            self.invertebrates += 1
        elif label.kind == "fish":
            self.total_fish += 1
            if label.species:
                self.per_species[label.species] = self.per_species.get(label.species, 0) + 1
            else:
                self.unknown += 1


def _is_sure(sightings: list[Sighting], label: TrackLabel, threshold: float) -> bool:
    return label.human or any(s.conf >= threshold for s in sightings)


def is_stationary(seen: list[Sighting], cfg: StationaryConfig | None) -> bool:
    """Seen in many pictures over several seconds, and its centre never moved (in % of the picture)."""
    if cfg is None:
        return False
    boxes = [s for s in seen if s.box is not None]
    if len(boxes) < cfg.min_sightings or max(s.t_s for s in boxes) - min(s.t_s for s in boxes) < cfg.min_span_s:
        return False
    cx = [s.box[0] + s.box[2] / 2 for s in boxes]
    cy = [s.box[1] + s.box[3] / 2 for s in boxes]
    return max(cx) - min(cx) <= cfg.max_shift_pct and max(cy) - min(cy) <= cfg.max_shift_pct


def suggested_visibility(clarity: float | None, cfg: ClarityConfig, categories: tuple[str, ...]) -> str | None:
    """Visibility category suggested from the clarity index (staff confirm it; only that is exported)."""
    if clarity is None:
        return None
    n = sum(clarity >= t for t in cfg.category_thresholds)
    return categories[min(n, len(categories) - 1)]


def count_point(video_id: str, point_no: int, timestamp_s: float, sightings: list[Sighting],
                labels: dict[str, TrackLabel], threshold: float, protocol: ProtocolConfig,
                clarity_values: list[float], clarity_cfg: ClarityConfig,
                previous_suggestion: str | None = None,
                stationary_cfg: StationaryConfig | None = None) -> PointCount:
    """Count one subsample point from the sightings in its context clip."""
    tol = protocol.count.effective_tolerance_s
    by_track: dict[str, list[Sighting]] = {}
    for s in sightings:
        by_track.setdefault(s.track_id, []).append(s)
    tally, uncertain, outside, still = _Tally(), 0, 0, 0
    for tid, seen in by_track.items():
        label = labels.get(tid, TrackLabel("fish", None, False))
        if label.kind == "not_organism":
            continue
        near = [s for s in seen if abs(s.t_s - timestamp_s) <= tol + _EPS]
        if not near:
            outside += 1
        elif not label.human and is_stationary(seen, stationary_cfg):
            still += 1
        elif _is_sure(near, label, threshold):
            tally.add(label)
        else:
            uncertain += 1

    clarity = round(statistics.median(clarity_values), 1) if clarity_values else None
    suggestion = suggested_visibility(clarity, clarity_cfg, protocol.visibility_categories)
    notes, review = [], False
    if outside:
        notes.append(f"{outside} seen within ±{protocol.subsample.context_s:g} s but outside ±{tol:g} s "
                     f"(not counted)")
    if uncertain:
        notes.append(f"{uncertain} possible fish below the certainty threshold need checking (not counted)")
        review = True
    if still:
        notes.append(f"{still} object{'s' if still != 1 else ''} that didn't move (pole markings, rocks or a "
                     "resting fish?) need checking (not counted)")
        review = True
    if clarity is not None and clarity < clarity_cfg.review_threshold:
        notes.append("low visibility")
        review = True
    if suggestion and previous_suggestion and suggestion != previous_suggestion:
        notes.append(f"visibility changed ({previous_suggestion} → {suggestion})")
        review = True
    return PointCount(video_id, point_no, timestamp_s, tally.total_fish, tally.invertebrates, tally.per_species,
                      tally.unknown, len(tally.per_species), None, clarity, suggestion, "; ".join(notes), review,
                      uncertain, outside, still)


def mean_count(points: list[PointCount], totals: list[int] | None = None) -> float | None:
    """MeanCount = sum of per-point fish counts ÷ number of points (zero points included)."""
    values = totals if totals is not None else [p.total_fish for p in points]
    return round(sum(values) / len(values), 3) if values else None


def species_richness(sightings: list[Sighting], labels: dict[str, TrackLabel], threshold: float) -> set[str]:
    """Distinct named fish species seen anywhere in the analysis window (sure or confirmed only)."""
    by_track: dict[str, list[Sighting]] = {}
    for s in sightings:
        by_track.setdefault(s.track_id, []).append(s)
    found = set()
    for tid, seen in by_track.items():
        label = labels.get(tid)
        if label and label.kind == "fish" and label.species and _is_sure(seen, label, threshold):
            found.add(label.species)
    return found


def count_image(file_id: str, rel_path: str, sightings: list[Sighting], labels: dict[str, TrackLabel],
                threshold: float) -> ImageCount:
    """Per-image counts: every detection is its own organism (images are never tracked)."""
    tally, uncertain = _Tally(), 0
    for s in sightings:
        label = labels.get(s.track_id, TrackLabel("fish", None, False))
        if label.kind == "not_organism":
            continue
        if _is_sure([s], label, threshold):
            tally.add(label)
        else:
            uncertain += 1
    notes = f"{uncertain} possible fish below the certainty threshold need checking (not counted)" if uncertain else ""
    return ImageCount(file_id, rel_path, tally.total_fish, tally.invertebrates, tally.per_species, tally.unknown,
                      notes, bool(uncertain))
