"""Survey results: per-point counts, MeanCount, species richness, clarity and image counts.

Built from stored rows each time they're asked for, so every staff label or point edit shows up
straight away (CLAUDE.md: recalculate after every change). Staff values are the final values; the
AI's values stay alongside them for evaluation.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .clarity import summarise
from .config import ClarityConfig, ProtocolConfig, StationaryConfig
from .count import (ImageCount, PointCount, Sighting, TrackLabel, count_image, count_point, mean_count,
                    species_richness)

_EPS = 1e-6


@dataclass
class PointResult:
    id: int
    ai: PointCount  # what the AI counted (never changed)
    total_fish: int  # final: staff value if set, else the AI's
    invertebrates: int
    visibility: str | None  # confirmed by staff
    staff_notes: str
    edited_by: str
    has_clip: bool

    @property
    def reviewed(self) -> bool:
        return bool(self.edited_by)


@dataclass
class VideoSummary:
    """One video's results (also one point on the Trends graphs)."""

    id: int
    name: str
    recorded_at: str
    transect: str
    stat: str
    window_start_s: float | None  # confirmed by a person; None until then (nothing is counted before)
    window_end_s: float | None
    proposed_start_s: float | None  # what the app proposed (US-2.1)
    proposed_end_s: float | None
    proposed_reason: str
    settled: bool | None
    too_short: bool  # flagged: not processed
    short_window: bool  # shorter than the protocol window: counts not comparable with full windows
    confirmed_by: str
    count_state: str  # "" (waiting for a confirmed window) | "queued" | "running" | "done" | "failed"
    count_detail: str
    points: list[PointResult]
    mean_count: float | None  # final (staff values where set)
    mean_count_ai: float | None  # the AI's alone
    species_found: list[str]  # species richness for the analysis window
    clarity_index: float | None  # video median
    clarity_min: float | None
    clarity_max: float | None
    clarity_trend: str | None
    visibility: str | None  # confirmed, else the most common suggestion
    reviewed: bool  # every point that needed review was reviewed by a person

    @property
    def species_richness(self) -> int:
        return len(self.species_found)


@dataclass
class SurveyResults:
    videos: list[VideoSummary] = field(default_factory=list)
    images: list[ImageCount] = field(default_factory=list)


def _sightings(rows) -> list[Sighting]:
    keys = rows[0].keys() if rows else []
    return [Sighting(r["track_id"], (r["t_s"] or 0.0) if "t_s" in keys else 0.0, r["confidence"],
                     (r["x"], r["y"], r["w"], r["h"]) if "x" in keys else None) for r in rows if r["track_id"]]


def video_summary(video, points, sightings, frames_by_point: dict[int, list], labels: dict[str, TrackLabel],
                  threshold: float, protocol: ProtocolConfig, clarity_cfg: ClarityConfig,
                  stationary_cfg: StationaryConfig | None = None) -> VideoSummary:
    """video, points: rows; sightings: detection rows with role/point_no/t_s; frames_by_point: point_no → frames."""
    tol = protocol.count.effective_tolerance_s
    results: list[PointResult] = []
    previous = None
    for p in points:
        in_point = [s for s in sightings if s["role"] == "point" and s["point_no"] == p["point_no"]]
        clar = [f["clarity"] for f in frames_by_point.get(p["point_no"], [])
                if f["clarity"] is not None and abs((f["t_s"] or 0) - p["timestamp_s"]) <= tol + _EPS]
        ai = count_point(str(video["id"]), p["point_no"], p["timestamp_s"], _sightings(in_point), labels, threshold,
                         protocol, clar, clarity_cfg, previous, stationary_cfg)
        previous = ai.suggested_visibility or previous
        results.append(PointResult(
            p["id"], ai,
            p["human_total_fish"] if p["human_total_fish"] is not None else ai.total_fish,
            p["human_invertebrates"] if p["human_invertebrates"] is not None else ai.invertebrates,
            p["visibility"] or None, p["notes"], p["edited_by"], bool(p["clip_path"])))
    window = [s for s in sightings if s["role"] in ("point", "scan")]
    found = sorted(species_richness(_sightings(window), labels, threshold))
    summary = summarise([r.ai.clarity_index for r in results if r.ai.clarity_index is not None])
    suggestions = [r.ai.suggested_visibility for r in results if r.ai.suggested_visibility]
    visibility = video["visibility"] or (max(set(suggestions), key=suggestions.count) if suggestions else None)
    return VideoSummary(
        video["id"], video["file_name"], video["recorded_at"], video["transect"], video["stat"],
        video["window_start_s"], video["window_end_s"], video["proposed_start_s"], video["proposed_end_s"],
        video["proposed_reason"], None if video["settled"] is None else bool(video["settled"]),
        bool(video["too_short"]), bool(video["short_window"]), video["confirmed_by"], video["count_state"], video["count_detail"], results,
        mean_count([r.ai for r in results], [r.total_fish for r in results]),
        mean_count([r.ai for r in results]), found, summary.median, summary.min, summary.max, summary.trend,
        visibility, bool(results) and all(r.reviewed for r in results if r.ai.needs_review))


def image_counts(rows, labels: dict[str, TrackLabel], threshold: float) -> list[ImageCount]:
    """rows: photo frames left-joined with their detections."""
    by_frame: dict[int, list] = {}
    names: dict[int, str] = {}
    for r in rows:
        names[r["frame_id"]] = r["source"]
        by_frame.setdefault(r["frame_id"], [])
        if r["id"] is not None:
            by_frame[r["frame_id"]].append(r)
    return [count_image(str(fid), names[fid], _sightings(dets), labels, threshold) for fid, dets in by_frame.items()]
