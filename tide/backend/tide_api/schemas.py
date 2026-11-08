"""Request/response shapes. These mirror app/src/shared/api.ts and survey.ts — change both together.

JSON uses camelCase (e.g. "speciesId") to match the TypeScript side; Python code uses snake_case.
"""
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


SpeciesStatus = Literal["native", "invasive", "unusual"]
SpeciesKind = Literal["fish", "invertebrate"]  # invertebrates (e.g. crabs) are counted separately from fish


class SpeciesIn(Model):
    common: str = Field(min_length=1)
    scientific: str = "—"
    status: SpeciesStatus = "native"
    habitat: str = "Marine"
    kind: SpeciesKind = "fish"
    added_by: str = ""  # name of the person who added it ("" = came with the app)


class SpeciesPatch(Model):
    common: Optional[str] = None
    scientific: Optional[str] = None
    status: Optional[SpeciesStatus] = None
    habitat: Optional[str] = None
    kind: Optional[SpeciesKind] = None


class Species(SpeciesIn):
    id: str
    custom: bool = False
    added_at: str = ""
    reference_count: int = 0  # reference pictures used to identify this species (BioCLIP 2)
    thumbnail: Optional[str] = None  # URL path of the first reference picture (Species Registry card)


class Reference(Model):
    """A reference picture of a species. The species model compares fish with these."""
    id: str
    species_id: str
    image: str  # URL path, e.g. "/references/3/image"
    source: str  # original file name, or "Survey 4, picture 12" when made from a checked fish
    added_by: str = ""
    added_at: str = ""
    # Where it came from (empty for pictures uploaded from this computer, and for older pictures):
    survey_id: Optional[int] = None
    survey_site: str = ""  # the survey's site name, if the survey still exists
    source_file: str = ""  # the video or picture file the fish was seen in
    source_time: str = ""  # time in the video, e.g. "00:06:00"


class ReferencesIn(Model):
    paths: list[str] = Field(min_length=1)  # full paths of pictures on this computer
    by: str = ""


class ReferenceFromDetection(Model):
    detection_id: str
    by: str = ""


class Suggestion(Model):
    species_id: str
    score: float  # similarity 0–1 to the species' reference pictures (not a probability)


class Box(Model):
    """Percentages (0–100) of the picture's width/height, from the top-left corner."""
    x: float
    y: float
    w: float
    h: float


class Detection(Model):
    id: str
    species_id: str  # a species id, or "not_fish"
    model_species_id: str  # what the model said (kept so staff can undo)
    confidence: float  # 0–1
    verified: bool  # a person confirmed or corrected it
    edited_by: str = ""  # who confirmed or corrected it
    box: Box
    # Filled by the real pipeline (empty in demo mode):
    track_id: str = ""  # the same fish across pictures of one video has the same track id
    ai_label: str = ""  # species id, "Unknown" or "Potential Novel Sighting" (what the species model said)
    suggestions: list[Suggestion] = []  # the species model's top guesses with scores, best first
    novelty: Optional[float] = None  # 0–1 distance to the nearest species with reference pictures
    unknown_reason: str = ""  # plain English, when the AI couldn't name the species
    possible_drift: bool = False  # moved exactly like the water (debris?): needs a person before it counts


class DetectionPatch(Model):
    species_id: str
    verified: bool
    by: str = ""  # name of the person making the change


class Frame(Model):
    id: str
    image: str  # URL path, e.g. "/frames/12/image"
    source: str  # original file name
    timestamp: str  # "00:01:47", or "Photo"
    clarity: Optional[float] = None  # 0–100 estimate of how clear the water is (None = not measured)
    quality: str = ""  # "clear" | "moderate" | "muddy" | "obscured" (can't identify fish here)
    quality_reasons: str = ""  # e.g. "blurred, hazy or turbid"
    static: bool = False  # same as the previous picture: the detector wasn't run again, boxes carried over
    detections: list[Detection]


class ProtocolSettings(Model):
    """The protocol values the Settings screen shows and changes. Times in seconds, QC in percent."""
    trim_start_s: float = Field(allow_inf_nan=False)
    trim_end_s: float = Field(allow_inf_nan=False)
    max_extra_settle_s: float = Field(allow_inf_nan=False)
    length_s: float = Field(allow_inf_nan=False)  # analysis window
    interval_s: float = Field(allow_inf_nan=False)  # one subsample point every interval_s
    first_point_offset_s: float = Field(allow_inf_nan=False)
    context_s: float = Field(allow_inf_nan=False)  # ± seconds around each point
    tolerance_s: float = Field(allow_inf_nan=False)  # ± seconds counted around each point
    max_tolerance_s: float = 1.0  # the protocol's limit for tolerance_s; shown, not changed here
    qc_sample_pct: float = Field(allow_inf_nan=False)  # % of points picked for blind QC
    qc_max_diff_pct: float = Field(allow_inf_nan=False)  # counts further apart than this need a recount
    qc_agreement_pct: float = Field(allow_inf_nan=False)  # % of QC points that should agree
    points_per_window: Optional[int] = None  # worked out by the back end; ignored when saving


class ProtocolSettingsState(Model):
    values: ProtocolSettings  # what new processing will use
    defaults: ProtocolSettings  # the shipped config/protocol.yaml
    source: Literal["default", "custom"]
    changed_by: str = ""  # last save or reset
    changed_at: str = ""
    warning: str = ""  # e.g. the saved copy couldn't be read, so the defaults are in use


class ProtocolCheck(Model):
    """Result of checking settings without saving them: points per window, or what's wrong per field."""
    points_per_window: Optional[int] = None
    errors: dict[str, str] = {}  # field name (e.g. "intervalS") -> plain-English reason


class SurveyInfo(Model):
    id: int
    site: str
    threshold: float
    created_at: str  # when it was analysed
    survey_date: str = ""  # when it was filmed (YYYY-MM-DD), "" if unknown
    created_by: str = ""
    files: list[str]
    frame_count: int
    status: Literal["running", "done", "failed", "cancelled"]
    # The protocol values this survey was processed with. For surveys processed before these were
    # recorded, the shipped defaults, and protocol_recorded is False (the report says so).
    protocol: Optional[ProtocolSettings] = None
    protocol_recorded: bool = False


class SurveyPatch(Model):
    site: Optional[str] = None
    survey_date: Optional[str] = None  # YYYY-MM-DD, or "" to clear


class SurveyData(Model):
    survey: SurveyInfo
    frames: list[Frame]


class Video(Model):
    """One video in a survey, with the proposed analysis window and the one a person confirmed."""
    id: str
    survey_id: int
    file_name: str
    duration_s: float
    fps: float
    proposed_start_s: Optional[float] = None  # None when the video is too short for the protocol
    proposed_end_s: Optional[float] = None
    proposed_reason: str  # plain English, e.g. "Sediment until about 02:04, so a later start is suggested…"
    settled: Optional[bool] = None  # False: sediment still unsettled at the latest allowed start
    too_short: bool = False  # flagged: can't be confirmed or processed
    settle_score: Optional[float] = None  # sediment score near the proposed start (lower = clearer)
    window_start_s: Optional[float] = None  # confirmed by a person; None until then
    window_end_s: Optional[float] = None
    confirmed_by: str = ""
    confirmed_at: str = ""
    short_window: bool = False  # shorter than the protocol window: counts not comparable with full windows


class VideoWindowPatch(Model):
    """Confirm (or change) a video's analysis window. Who did it comes from the X-TIDE-User header."""
    window_start_s: float = Field(allow_inf_nan=False)
    window_end_s: float = Field(allow_inf_nan=False)


class AnalysisRequest(Model):
    site: str = ""
    survey_date: str = ""  # YYYY-MM-DD the footage was filmed; used by Trends
    person: str = ""  # who started it
    threshold: float = Field(0.5, ge=0, le=1)
    sampling: Literal[1, 2, 5] = 1  # pictures per second of video
    enhance: bool = True  # clear up murky water
    ignore_specks: bool = True  # drop tiny boxes (sediment, bubbles); size in app.yaml detect.speck_max_area_pct
    look_closer: bool = False  # also search the full-resolution picture in tiles: more small fish, slower
    tracker: Optional[Literal["bytetrack", "ocsort"]] = None  # None: app.yaml track.tracker
    files: list[str] = Field(min_length=1)  # full paths on this computer


class FileStatus(Model):
    name: str
    state: Literal["waiting", "working", "done", "failed", "skipped"]
    detail: str = ""  # e.g. "14 pictures" or the reason it failed / was skipped


class Job(Model):
    job_id: str
    survey_id: int
    state: Literal["running", "done", "failed", "cancelled"]
    percent: int  # 0–100
    stage: int  # index into the UI's list of stages (0 splitting … 4 writing report)
    detail: str
    error: Optional[str] = None
    files: list[FileStatus] = []  # one entry per file; a failed file never stops the others


class ModelStatus(Model):
    ready: bool
    demo: bool
    name: str
    message: str
    device: Literal["gpu", "cpu"] = "cpu"  # shown as "GPU mode" / "CPU mode"
    gpu: str = ""  # graphics card name in GPU mode
    species_model: str = ""  # e.g. "BioCLIP 2", or "" when it isn't installed
    references: int = 0  # reference pictures in the species list


class Reidentified(Model):
    tracks: int  # fish (tracks) matched again
    changed: int  # boxes whose species changed (boxes staff already checked never change)


class Health(Model):
    status: Literal["ok"] = "ok"
    version: str


class Person(Model):
    name: str = Field(min_length=1, max_length=40)
    role: str = ""  # e.g. "analyst", "QC reviewer"


class QcCountIn(Model):
    frame_id: str
    person: str = Field(min_length=1)
    fish: int = Field(ge=0)
    invertebrates: int = Field(0, ge=0)


class QcCount(QcCountIn):
    created_at: str


class QcData(Model):
    """A random sample of a survey's pictures for a blind recount, and the counts so far."""
    sample: list[str]  # frame ids, in order
    counts: list[QcCount]


class Storage(Model):
    data_dir: str
    free_bytes: int
    total_bytes: int
    pictures_bytes: int
    database_bytes: int


# ── Protocol results (subsample points, MeanCount, richness, images) ──

class AiPointCount(Model):
    total_fish: int
    invertebrates: int


class PointOut(Model):
    id: int
    point_no: int
    timestamp_s: float
    total_fish: int  # final: a person's value if they changed it, else the AI's
    invertebrates: int
    per_species: dict[str, int]  # species id → count (the AI's, after labels)
    unknown: int  # "Unknown/Unable to ID due to visibility"
    species_observed: int
    clarity_index: Optional[float] = None  # 0–100 estimate, median over the tolerance window
    suggested_visibility: Optional[str] = None
    visibility: Optional[str] = None  # confirmed by staff (only this is exported as visibility)
    notes: str  # the AI's notes (fish outside the tolerance window, low visibility…)
    staff_notes: str = ""
    needs_review: bool
    reviewed: bool
    edited_by: str = ""
    uncertain: int = 0
    outside: int = 0
    stationary: int = 0  # objects that didn't move (pole markings, rocks, a resting fish?), not counted
    drifting: int = 0  # tracks that moved like the water (debris?), not counted until a person confirms
    unidentifiable: int = 0  # possible fish only in pictures too murky to identify them, not counted
    ai: AiPointCount  # the AI's counts, never changed
    clip: Optional[str] = None  # URL path of the ±context clip, e.g. "/points/3/clip"


class VideoOut(Model):
    id: int
    name: str
    recorded_at: str
    transect: str
    stat: str
    window_start_s: Optional[float] = None  # confirmed by a person; nothing is counted until then
    window_end_s: Optional[float] = None
    proposed_start_s: Optional[float] = None  # what the app proposed (see GET /surveys/{id}/videos)
    proposed_end_s: Optional[float] = None
    proposed_reason: str = ""
    settled: Optional[bool] = None
    too_short: bool = False  # flagged: not processed
    short_window: bool = False  # shorter than the protocol window (window.allow_short_videos)
    confirmed_by: str = ""
    count_state: str = ""  # "" (waiting for a confirmed window) | "queued" | "running" | "done" | "failed"
    count_detail: str = ""
    points: list[PointOut]
    mean_count: Optional[float] = None
    mean_count_ai: Optional[float] = None
    species_richness: int
    species_found: list[str]
    clarity_index: Optional[float] = None  # video median
    clarity_min: Optional[float] = None
    clarity_max: Optional[float] = None
    clarity_trend: Optional[str] = None
    visibility: Optional[str] = None
    reviewed: bool
    unknowns_remaining: int = 0


class ImageOut(Model):
    file_id: str
    rel_path: str
    total_fish: int
    invertebrates: int
    per_species: dict[str, int]
    unknown: int
    notes: str
    needs_review: bool


class SurveyResults(Model):
    videos: list[VideoOut]
    images: list[ImageOut]
    unknowns_remaining: int
    visibility_categories: list[str]


class VideoDetailsPatch(Model):
    """Recording details (the window itself is confirmed with PATCH /videos/{id})."""
    recorded_at: Optional[str] = None  # YYYY-MM-DD
    transect: Optional[str] = None
    stat: Optional[str] = None
    visibility: Optional[str] = None  # confirmed visibility category for the whole video


class PointPatch(Model):
    total_fish: Optional[int] = Field(None, ge=-1)  # -1 = back to the AI's value
    invertebrates: Optional[int] = Field(None, ge=-1)
    visibility: Optional[str] = None
    notes: Optional[str] = None
    by: str = Field(min_length=1)


# ── Labelling unknown fish ──

class LabelOut(Model):
    id: str
    action: str
    species: Optional[str] = None
    invertebrate_type: Optional[str] = None
    labelled_by: str
    labelled_at: str


class UnknownSource(Model):
    kind: Literal["video", "image"]
    file: str
    video_id: Optional[int] = None
    point_no: Optional[int] = None
    timestamp: str  # "00:01:47" or "Photo"
    role: str  # "point" | "scan" | "photo"


class UnknownFish(Model):
    """One card per tracked organism the AI left as Unknown or Potential Novel Sighting."""
    track_id: str
    crop: str  # URL path of the best crop
    source: UnknownSource
    frame_ids: list[str]  # pictures this organism appears in, in time order
    best_frame_id: str
    box: Box  # on the best picture
    ai_label: str
    suggestions: list[Suggestion]
    reason: str
    label: Optional[LabelOut] = None  # the current label, if staff labelled it


class Unknowns(Model):
    fish: list[UnknownFish]
    remaining: int
    remaining_by_file: dict[str, int]


class LabelIn(Model):
    survey_id: int
    action: Literal["species", "unidentifiable", "not_organism", "invertebrate"]
    track_ids: list[str] = []  # one or more organisms (bulk labelling)
    species: Optional[str] = None  # registry species id when action == "species"
    invertebrate_type: Optional[Literal["crab", "shrimp", "worm", "snail"]] = None
    use_as_reference: bool = False
    frame_id: Optional[str] = None  # with box: a box the person drew around an organism the AI missed
    box: Optional[Box] = None
    by: str = Field(min_length=1)


class LabelResult(Model):
    label_ids: list[str]
    remaining: int


# ── Evaluation against hand counts ──

class EvaluationIn(Model):
    path: Optional[str] = None  # CSV of hand counts on this computer; empty = use points staff corrected


class PointComparisonOut(Model):
    video: str
    point_no: int
    ai: int
    human: int
    abs_diff: int
    pct_diff: float
    within: bool


class VideoComparisonOut(Model):
    video: str
    points: int
    mean_count_ai: float
    mean_count_human: float
    mean_count_abs_diff: float
    mean_count_pct_diff: float
    share_within: float
    zero_agreement: float


class EvaluationOut(Model):
    points_compared: int
    share_within: Optional[float] = None
    mean_abs_diff: Optional[float] = None
    median_pct_diff: Optional[float] = None
    zero_agreement: Optional[float] = None
    meets_agreement: Optional[bool] = None
    max_pct_diff: float
    min_agreement: float
    videos: list[VideoComparisonOut]
    points: list[PointComparisonOut]
    unmatched_human: list[str]
    source: str
