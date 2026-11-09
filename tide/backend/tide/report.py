"""What the downloadable survey report adds up, from survey results that are already final.

Species are listed per survey. MeanCount is never added here: it stays per video (protocol rule), and
images are never part of it. A species' status is only ever a person's note.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .count import ImageCount, TrackLabel
from .results import VideoSummary


@dataclass
class SpeciesFinding:
    species_id: str
    total_at_points: int  # sum over the subsample points; the same fish can appear at several points
    points_seen: int
    in_images: int
    seen_between_points: bool  # found by the full-window scan but at no subsample point or image
    human_approved: bool  # a person confirmed at least one organism of this species


@dataclass
class Findings:
    identified_species: int
    ai_only: int
    human_approved: int
    native_noted: int
    invasive_noted: int
    unusual_noted: int
    status_not_noted: int
    unidentified_fish: int
    invertebrates: int
    points_total: int
    species: list[SpeciesFinding] = field(default_factory=list)


def findings(videos: list[VideoSummary], images: list[ImageCount], labels: dict[str, TrackLabel],
             noted_status: dict[str, str | None]) -> Findings:
    """noted_status: every species that can be named → the status a person noted, or None if nobody has."""
    points = [p for v in videos for p in v.points]
    total: dict[str, int] = {}
    seen: dict[str, int] = {}
    for p in points:
        for sp, n in p.ai.per_species.items():
            total[sp] = total.get(sp, 0) + n
            seen[sp] = seen.get(sp, 0) + (1 if n else 0)
    photos: dict[str, int] = {}
    for image in images:
        for sp, n in image.per_species.items():
            photos[sp] = photos.get(sp, 0) + n
    scanned = {sp for v in videos for sp in v.species_found}
    named = sorted(sp for sp in set(total) | set(photos) | scanned if sp in noted_status)
    confirmed = {t.species for t in labels.values() if t.human and t.species}
    rows = [SpeciesFinding(sp, total.get(sp, 0), seen.get(sp, 0), photos.get(sp, 0),
                           not seen.get(sp) and not photos.get(sp), sp in confirmed) for sp in named]
    rows.sort(key=lambda r: (-r.total_at_points, -r.in_images, r.species_id))
    status = [noted_status[r.species_id] for r in rows]
    approved = sum(r.human_approved for r in rows)
    return Findings(
        len(rows), len(rows) - approved, approved, status.count("native"), status.count("invasive"),
        status.count("unusual"), status.count(None),
        sum(p.ai.unknown for p in points) + sum(i.unknown for i in images),
        sum(p.invertebrates for p in points) + sum(i.invertebrates for i in images),
        len(points), rows)
