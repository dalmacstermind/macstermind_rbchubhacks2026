"""One point per counted video for the Trends graphs (CLAUDE.md, Trends page).

Every video is either a point on the graphs or listed with the reason it isn't, so nothing
disappears silently. Videos that weren't counted never become points: a 0 would look like a result.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from statistics import mean

from .results import VideoSummary as VideoResult

TOO_SHORT = "too_short"
NOT_CONFIRMED = "not_confirmed"
COUNTING = "counting"
NOT_COUNTED = "not_counted"
NO_DATE = "no_date"
NOT_REVIEWED = "not_reviewed"

_EXPLANATION = {
    TOO_SHORT: "Too short for the protocol, so it isn't counted",
    NOT_CONFIRMED: "Analysis window not confirmed yet",
    COUNTING: "Still being counted",
    NO_DATE: "No recording date",
    NOT_REVIEWED: "Counted, but not reviewed yet",
}
_NOT_COUNTED_EXPLANATION = {
    "failed": "Counting failed: count it again",
    "stopped": "Counting was stopped: count it again",
}


@dataclass
class TrendVideo:
    """One video's results and the survey it belongs to."""

    survey_id: int
    survey_site: str
    survey_date: str  # used when the video has no recording date of its own
    result: VideoResult


@dataclass
class TrendFilters:
    transect: str = ""
    stat: str = ""
    date_from: str = ""  # YYYY-MM-DD
    date_to: str = ""
    reviewed_only: bool = True


@dataclass
class VideoSummary:
    """One point on the Trends graphs."""

    video_id: int
    survey_id: int
    survey_site: str
    file_name: str
    label: str
    recorded_at: str  # YYYY-MM-DD
    transect: str
    stat: str
    species_found: int  # species richness for the analysis window
    mean_count: float | None
    clarity_index: float | None  # video median
    clarity_min: float | None
    clarity_max: float | None
    clarity_trend: str | None
    visibility: str | None  # confirmed or suggested category
    reviewed: bool
    short_window: bool  # shorter than the protocol window: not comparable with full windows
    imported: bool = False  # True for history imported from past spreadsheets


@dataclass
class NotPlotted:
    """A video that isn't on the graphs, and why."""

    video_id: int
    survey_id: int
    survey_site: str
    file_name: str
    transect: str
    stat: str
    recorded_at: str
    reason: str
    explanation: str


@dataclass
class DateGroup:
    """All the plotted videos of one date: mean, min–max range and number of videos."""

    label: str
    recorded_at: str
    videos: int
    clarity_mean: float | None
    clarity_min: float | None
    clarity_max: float | None
    species_mean: float
    species_min: int
    species_max: int
    mean_count: float | None


@dataclass
class Trends:
    points: list[VideoSummary] = field(default_factory=list)
    groups: list[DateGroup] = field(default_factory=list)  # filled when grouping by survey date
    not_plotted: list[NotPlotted] = field(default_factory=list)
    transects: list[str] = field(default_factory=list)  # every value the filters can offer
    stats: list[str] = field(default_factory=list)


def _not_counted_reason(r: VideoResult) -> str | None:
    if r.too_short:
        return TOO_SHORT
    if not r.confirmed_by:
        return NOT_CONFIRMED
    if r.count_state in ("queued", "running"):
        return COUNTING
    if r.count_state in ("failed", "stopped") or not r.points:
        return NOT_COUNTED
    return None


def _not_plotted(v: TrendVideo, when: str, reason: str) -> NotPlotted:
    r = v.result
    explanation = (_NOT_COUNTED_EXPLANATION.get(r.count_state, "Not counted yet") if reason == NOT_COUNTED
                   else _EXPLANATION[reason])
    return NotPlotted(r.id, v.survey_id, v.survey_site, r.name, r.transect, r.stat, when, reason, explanation)


def _point(v: TrendVideo, when: str) -> VideoSummary:
    r = v.result
    place = " ".join(x for x in (r.transect, r.stat) if x)
    return VideoSummary(r.id, v.survey_id, v.survey_site, r.name, f"{when} · {place}" if place else when, when,
                        r.transect, r.stat, r.species_richness, r.mean_count, r.clarity_index, r.clarity_min,
                        r.clarity_max, r.clarity_trend, r.visibility, r.reviewed, r.short_window)


def _round_mean(values: list[float]) -> float | None:
    return round(mean(values), 2) if values else None


def group_by_date(points: list[VideoSummary]) -> list[DateGroup]:
    """Group by survey date: mean with min–max range and number of videos. Clarity uses each video's median."""
    by_date: dict[str, list[VideoSummary]] = {}
    for p in points:
        by_date.setdefault(p.recorded_at, []).append(p)
    groups = []
    for when in sorted(by_date):
        videos = by_date[when]
        clarity = [p.clarity_index for p in videos if p.clarity_index is not None]
        species = [p.species_found for p in videos]
        groups.append(DateGroup(
            when, when, len(videos), _round_mean(clarity), min(clarity, default=None), max(clarity, default=None),
            _round_mean(species) or 0.0, min(species), max(species),
            _round_mean([p.mean_count for p in videos if p.mean_count is not None])))
    return groups


def _in_filters(v: TrendVideo, when: str, f: TrendFilters) -> bool:
    """Videos without a date stay listed whatever the date range: they still need one."""
    return ((not f.transect or v.result.transect == f.transect) and (not f.stat or v.result.stat == f.stat)
            and (not when or ((not f.date_from or when >= f.date_from) and (not f.date_to or when <= f.date_to))))


def build_trends(videos: list[TrendVideo], filters: TrendFilters, group_by_survey: bool = False) -> Trends:
    """The Trends page: points in recording-date order, plus every other video with its reason."""
    out = Trends(transects=sorted({v.result.transect for v in videos if v.result.transect}),
                 stats=sorted({v.result.stat for v in videos if v.result.stat}))
    for v in videos:
        when = v.result.recorded_at or v.survey_date
        if not _in_filters(v, when, filters):
            continue
        reason = _not_counted_reason(v.result)
        if reason is None and not when:
            reason = NO_DATE
        if reason is None and filters.reviewed_only and not v.result.reviewed:
            reason = NOT_REVIEWED
        if reason is None:
            out.points.append(_point(v, when))
        else:
            out.not_plotted.append(_not_plotted(v, when, reason))
    out.points.sort(key=lambda p: (p.recorded_at, p.survey_id, p.video_id))
    if group_by_survey:
        out.groups = group_by_date(out.points)
    return out
