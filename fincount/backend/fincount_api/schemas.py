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
    detections: list[Detection]


class SurveyInfo(Model):
    id: int
    site: str
    environment: str
    threshold: float
    created_at: str  # when it was analysed
    survey_date: str = ""  # when it was filmed (YYYY-MM-DD), "" if unknown
    created_by: str = ""
    files: list[str]
    frame_count: int
    status: Literal["running", "done", "failed", "cancelled"]


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


class VideoWindowPatch(Model):
    """Confirm (or change) a video's analysis window. Who did it comes from the X-FinCount-User header."""
    window_start_s: float = Field(allow_inf_nan=False)
    window_end_s: float = Field(allow_inf_nan=False)


class AnalysisRequest(Model):
    site: str = ""
    survey_date: str = ""  # YYYY-MM-DD the footage was filmed; used by Trends
    person: str = ""  # who started it
    environment: str = "Coastal marine"
    threshold: float = Field(0.5, ge=0, le=1)
    sampling: Literal[1, 2, 5] = 1  # pictures per second of video
    enhance: bool = True  # clear up murky water
    ignore_specks: bool = True  # drop tiny boxes (sediment, bubbles)
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
