"""FinCount API. Runs only on this computer (127.0.0.1); the desktop app starts and stops it.

Interactive docs while it's running: http://127.0.0.1:8765/docs
The contract is described in ../API.md — keep the two in step.
"""
import os
import re
import secrets
import shutil
from pathlib import Path
from urllib.parse import unquote

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from aquavision.config import load_app_config
from aquavision.protocol import WindowError, validate_window

from . import __version__
from .db import Database
from aquavision.detect import ModelMissingError

from . import pipeline, survey_results
from .pipeline import Jobs, model_status
from .schemas import (AnalysisRequest, DetectionPatch, EvaluationIn, EvaluationOut, Frame, Health, Job, LabelIn,
                      LabelResult, ModelStatus, Person, PointPatch, ProtocolCheck, ProtocolSettings,
                      ProtocolSettingsState, QcCountIn, QcData, Reference, ReferenceFromDetection, ReferencesIn,
                      Reidentified, Species, SpeciesIn, SpeciesPatch, Storage, SurveyData, SurveyInfo, SurveyPatch,
                      SurveyResults, Unknowns, Video, VideoDetailsPatch, VideoWindowPatch)
from .settings import ProtocolSettingsStore, SettingsError, apply_settings, points_per_window

DATA_DIR = Path(os.environ.get("FINCOUNT_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
# The desktop app passes a random token so other programs (or web pages) on this PC can't use the API.
# When it's not set (development), no token is needed.
TOKEN = os.environ.get("FINCOUNT_TOKEN", "")

app_config = load_app_config()
db = Database(DATA_DIR / "fincount.db")
# Protocol settings: staff's saved copy in the data folder, or the shipped config/protocol.yaml.
# New surveys use `protocol`; each survey keeps a snapshot of the values it started with.
settings_store = ProtocolSettingsStore(DATA_DIR, db)
protocol = settings_store.current
jobs = Jobs(db, DATA_DIR, protocol, app_config)


def check_token(x_fincount_token: str = Header(""), token: str = Query("")):
    if TOKEN and not (secrets.compare_digest(x_fincount_token, TOKEN) or secrets.compare_digest(token, TOKEN)):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing or wrong token")


app = FastAPI(title="FinCount API", version=__version__, dependencies=[Depends(check_token)])
# The UI is served from the Vite dev server (development) or a local file (installed app).
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health", response_model=Health, tags=["app"])
def health():
    return Health(version=__version__)


@app.get("/model", response_model=ModelStatus, tags=["app"])
def get_model():
    return model_status(db)


@app.get("/storage", response_model=Storage, tags=["app"])
def storage():
    usage = shutil.disk_usage(DATA_DIR)
    pictures = sum(f.stat().st_size for f in jobs.surveys_dir().rglob("*") if f.is_file()) \
        if jobs.surveys_dir().exists() else 0
    database = sum(f.stat().st_size for f in DATA_DIR.glob("fincount.db*"))
    return Storage(data_dir=str(DATA_DIR), free_bytes=usage.free, total_bytes=usage.total,
                   pictures_bytes=pictures, database_bytes=database)


# ── People (no passwords: names only, saved with checks and QC counts) ──

@app.get("/people", response_model=list[Person], tags=["people"])
def list_people():
    return db.list_people()


@app.post("/people", response_model=list[Person], tags=["people"])
def add_person(body: Person):
    db.add_person(body)
    return db.list_people()


@app.delete("/people/{name}", response_model=list[Person], tags=["people"])
def remove_person(name: str):
    db.remove_person(name)
    return db.list_people()


# ── Species ──

@app.get("/species", response_model=list[Species], tags=["species"])
def list_species():
    return db.list_species()


@app.post("/species", response_model=list[Species], tags=["species"])
def add_species(body: SpeciesIn):
    try:
        db.add_species(body)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return db.list_species()


@app.patch("/species/{species_id}", response_model=list[Species], tags=["species"])
def update_species(species_id: str, body: SpeciesPatch):
    if not db.update_species(species_id, body):
        raise HTTPException(404, "No such species")
    return db.list_species()


@app.delete("/species/{species_id}", response_model=list[Species], tags=["species"])
def remove_species(species_id: str):
    for path in db.remove_species(species_id):  # only species staff added can be removed
        path.unlink(missing_ok=True)
    return db.list_species()


@app.post("/species/reset", response_model=list[Species], tags=["species"])
def reset_species():
    db.reset_species()
    return db.list_species()


# ── Species reference pictures (the species model compares fish with these) ──

def _species_or_404(species_id: str) -> None:
    if not any(s.id == species_id for s in db.list_species()):
        raise HTTPException(404, "No such species")


@app.get("/species/{species_id}/references", response_model=list[Reference], tags=["species"])
def list_references(species_id: str):
    _species_or_404(species_id)
    return db.list_references(species_id)


@app.post("/species/{species_id}/references", response_model=list[Reference], tags=["species"])
def add_references(species_id: str, body: ReferencesIn):
    """Add pictures from this computer (full paths, like /analyses) as references for a species."""
    _species_or_404(species_id)
    missing = [p for p in body.paths if not Path(p).is_file()]
    if missing:
        raise HTTPException(400, f"Can't find: {', '.join(Path(m).name for m in missing)}")
    try:
        pipeline.add_reference_pictures(db, DATA_DIR, species_id, body.paths, body.by)
    except ModelMissingError as e:
        raise HTTPException(503, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return db.list_references(species_id)


@app.post("/species/{species_id}/references/from-detection", response_model=list[Reference], tags=["species"])
def add_reference_from_detection(species_id: str, body: ReferenceFromDetection):
    """Use a checked fish's crop as a reference picture for a species."""
    _species_or_404(species_id)
    try:
        pipeline.add_reference_from_detection(db, DATA_DIR, species_id, int(body.detection_id), body.by)
    except ModelMissingError as e:
        raise HTTPException(503, str(e))
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return db.list_references(species_id)


@app.delete("/references/{ref_id}", status_code=204, tags=["species"])
def remove_reference(ref_id: int):
    path = db.remove_reference(ref_id)
    if path:
        path.unlink(missing_ok=True)
    return Response(status_code=204)


@app.get("/references/{ref_id}/image", response_class=FileResponse, tags=["species"])
def reference_image(ref_id: int):
    path = db.reference_image(ref_id)
    if not path or not path.is_file():
        raise HTTPException(404, "No such picture")
    return FileResponse(path, headers={"Cache-Control": "max-age=31536000, immutable"})


# ── Analysis ──

@app.post("/analyses", response_model=Job, status_code=202, tags=["analysis"])
def start_analysis(body: AnalysisRequest):
    try:
        return jobs.start(body)
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    except FileNotFoundError as e:
        raise HTTPException(400, str(e))


@app.get("/analyses/{job_id}", response_model=Job, tags=["analysis"])
def get_analysis(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "No such analysis")
    return job


@app.post("/analyses/{job_id}/cancel", status_code=204, tags=["analysis"])
def cancel_analysis(job_id: str):
    if not jobs.cancel(job_id):
        raise HTTPException(404, "No such analysis")
    return Response(status_code=204)


# ── Surveys ──

@app.get("/surveys", response_model=list[SurveyInfo], tags=["surveys"])
def list_surveys():
    return db.list_surveys()


@app.get("/surveys/{survey_id}", response_model=SurveyData, tags=["surveys"])
def get_survey(survey_id: int):
    found = db.get_survey(survey_id)
    if not found:
        raise HTTPException(404, "No such survey")
    info, frames = found
    return SurveyData(survey=info, frames=[
        Frame(id=str(f["id"]), image=f"/frames/{f['id']}/image", source=f["source"], timestamp=f["timestamp"],
              clarity=f["clarity"], detections=dets)
        for f, dets in frames
    ])


@app.patch("/surveys/{survey_id}", status_code=204, tags=["surveys"])
def update_survey(survey_id: int, body: SurveyPatch):
    if body.survey_date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", body.survey_date):
        raise HTTPException(422, "Date must look like 2025-08-20.")
    if not db.update_survey(survey_id, body.site, body.survey_date):
        raise HTTPException(404, "No such survey")
    return Response(status_code=204)


@app.post("/surveys/{survey_id}/reidentify", response_model=Reidentified, tags=["surveys"])
def reidentify(survey_id: int):
    """Match the survey's fish again against the current reference pictures (after adding references).
    Boxes staff already checked keep their species."""
    if not db.get_survey(survey_id):
        raise HTTPException(404, "No such survey")
    try:
        return pipeline.reidentify(db, survey_id)
    except ModelMissingError as e:
        raise HTTPException(503, str(e))


@app.delete("/surveys/{survey_id}", status_code=204, tags=["surveys"])
def delete_survey(survey_id: int):
    db.delete_survey(survey_id)
    shutil.rmtree(jobs.surveys_dir() / str(survey_id), ignore_errors=True)
    return Response(status_code=204)


@app.get("/surveys/{survey_id}/videos", response_model=list[Video], tags=["surveys"])
def list_videos(survey_id: int):
    videos = db.list_videos(survey_id)
    if videos is None:
        raise HTTPException(404, "No such survey")
    return videos


def _person(x_fincount_user: str, what: str) -> str:
    """Who's working, from the X-FinCount-User header (URL-encoded by the app). Must be on the people list."""
    person = unquote(x_fincount_user).strip()
    if not person or not db.person_exists(person):
        raise HTTPException(400, f"Pick who's working first, so {what} is saved with your name.")
    return person


@app.patch("/videos/{video_id}", response_model=Video, tags=["surveys"])
def confirm_window(video_id: int, body: VideoWindowPatch, x_fincount_user: str = Header("")):
    """Confirm or change a video's analysis window. The app sends who's working, URL-encoded."""
    person = _person(x_fincount_user, "the window")
    video = db.get_video(video_id)
    if not video:
        raise HTTPException(404, "No such video")
    if video.too_short:
        raise HTTPException(422, f"{video.file_name} is too short for the protocol, so its window can't be "
                                 "confirmed or processed.")
    rules = jobs.protocol_for(video.survey_id).window  # the rules this survey was processed with
    try:
        validate_window(body.window_start_s, body.window_end_s, video.duration_s, video.fps, rules)
    except WindowError as e:
        raise HTTPException(422, str(e))
    confirmed = db.confirm_window(video_id, body.window_start_s, body.window_end_s, person)
    jobs.count_video(video_id)  # count the subsample points in the confirmed window (in the background)
    return confirmed


@app.get("/frames/{frame_id}/image", response_class=FileResponse, tags=["surveys"])
def frame_image(frame_id: int):
    path = db.frame_image(frame_id)
    if not path or not path.is_file():
        raise HTTPException(404, "No such picture")
    return FileResponse(path, headers={"Cache-Control": "max-age=31536000, immutable"})


# ── Staff checks ──

@app.patch("/detections/{detection_id}", status_code=204, tags=["surveys"])
def update_detection(detection_id: int, body: DetectionPatch):
    if not db.update_detection(detection_id, body.species_id, body.verified, body.by):
        raise HTTPException(404, "No such detection")
    return Response(status_code=204)



# ── Blind QC ──

def _qc_percent(survey_id: int, percent: float | None) -> float:
    """QC sample size: the survey's protocol snapshot (qc.sample_fraction) unless the caller gives one."""
    return percent if percent is not None else jobs.protocol_for(survey_id).qc.sample_fraction * 100


@app.get("/surveys/{survey_id}/qc", response_model=QcData, tags=["qc"])
def get_qc(survey_id: int, percent: float | None = Query(None, gt=0, le=100)):
    """The random sample is picked the first time this is called for a survey, then kept."""
    if not db.get_survey(survey_id):
        raise HTTPException(404, "No such survey")
    sample, counts = db.qc(survey_id, _qc_percent(survey_id, percent))
    return QcData(sample=sample, counts=counts)


@app.post("/surveys/{survey_id}/qc", response_model=QcData, tags=["qc"])
def add_qc_count(survey_id: int, body: QcCountIn, percent: float | None = Query(None, gt=0, le=100)):
    if not db.add_qc_count(survey_id, body):
        raise HTTPException(400, "That picture isn't in this survey's QC sample.")
    sample, counts = db.qc(survey_id, _qc_percent(survey_id, percent))
    return QcData(sample=sample, counts=counts)


# ── Protocol settings (Settings screen). Changes apply to new processing only. ──

@app.get("/settings/protocol", response_model=ProtocolSettingsState, tags=["settings"])
def get_protocol_settings():
    return settings_store.state()


@app.put("/settings/protocol", tags=["settings"],
         response_model=ProtocolSettingsState | ProtocolCheck)
def save_protocol_settings(body: ProtocolSettings, check: bool = False, x_fincount_user: str = Header("")):
    """Save the protocol settings for new surveys. With ?check=true nothing is saved: the reply says how
    many points a window gets, or what's wrong with each field (so the screen can explain as staff type)."""
    if check:
        try:
            return ProtocolCheck(points_per_window=points_per_window(apply_settings(settings_store.current, body)))
        except SettingsError as e:
            return ProtocolCheck(errors=e.errors)
    person = _person(x_fincount_user, "the change")
    try:
        _use_protocol(settings_store.save(body, person))
    except SettingsError as e:
        raise HTTPException(422, str(e))
    return settings_store.state()


@app.delete("/settings/protocol", response_model=ProtocolSettingsState, tags=["settings"])
def reset_protocol_settings(x_fincount_user: str = Header("")):
    """Back to the shipped defaults (config/protocol.yaml), for new surveys."""
    _use_protocol(settings_store.reset(_person(x_fincount_user, "the change")))
    return settings_store.state()


def _use_protocol(cfg) -> None:
    global protocol
    protocol = jobs.protocol = cfg  # new surveys use these; earlier surveys keep their snapshot


# ── Protocol results: subsample points, MeanCount, species richness, image counts ──

def _survey_or_404(survey_id: int):
    found = db.get_survey(survey_id)
    if not found:
        raise HTTPException(404, "No such survey")
    return found[0]


@app.get("/surveys/{survey_id}/results", response_model=SurveyResults, tags=["results"])
def survey_results_route(survey_id: int):
    """Videos with per-point counts, MeanCount and species richness; per-image counts. Recalculated each time."""
    info = _survey_or_404(survey_id)
    return survey_results.build_results(db, survey_id, info.threshold)


@app.patch("/videos/{video_id}/details", status_code=204, tags=["results"])
def update_video_details(video_id: int, body: VideoDetailsPatch):
    """Correct the recording date / Transect / STAT, or confirm the video's visibility category."""
    if body.recorded_at and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", body.recorded_at):
        raise HTTPException(422, "Date must look like 2025-08-20.")
    if not db.update_video_details(video_id, body.model_dump()):
        raise HTTPException(404, "No such video")
    return Response(status_code=204)


@app.patch("/points/{point_id}", status_code=204, tags=["results"])
def update_point(point_id: int, body: PointPatch):
    """A person's review of one point. The AI's original values are kept next to it."""
    if not db.update_point(point_id, {"human_total_fish": body.total_fish, "human_invertebrates": body.invertebrates,
                                      "visibility": body.visibility, "notes": body.notes}, body.by):
        raise HTTPException(404, "No such point")
    return Response(status_code=204)


@app.get("/points/{point_id}/clip", response_class=FileResponse, tags=["results"])
def point_clip(point_id: int):
    p = db.point(point_id)
    if not p or not p["clip_path"] or not Path(p["clip_path"]).is_file():
        raise HTTPException(404, "There's no saved clip for this point.")
    return FileResponse(p["clip_path"], media_type="video/mp4")


# ── Labelling unknown fish ──

@app.get("/surveys/{survey_id}/unknowns", response_model=Unknowns, tags=["labels"])
def list_unknowns(survey_id: int):
    _survey_or_404(survey_id)
    return survey_results.unknowns(db, survey_id)


@app.get("/surveys/{survey_id}/tracks/{track_id}/crop", tags=["labels"])
def track_crop(survey_id: int, track_id: str):
    crop = survey_results.crop_image(db, survey_id, track_id)
    if crop is None:
        raise HTTPException(404, "No picture of that fish")
    if isinstance(crop, Path):
        return FileResponse(crop, headers={"Cache-Control": "max-age=31536000, immutable"})
    return Response(content=crop, media_type="image/jpeg")


@app.post("/labels", response_model=LabelResult, tags=["labels"])
def add_labels(body: LabelIn):
    """Label one or more organisms (or a box drawn around one the AI missed). Counts update straight away."""
    _survey_or_404(body.survey_id)
    if (body.box is None) != (body.frame_id is None):
        raise HTTPException(422, "A drawn box needs both the picture and the box.")

    def add_reference(species_id: str, crop: Path, by: str):
        try:
            pipeline.add_reference_pictures(db, DATA_DIR, species_id, [str(crop)], by)
        except ModelMissingError:
            pass  # labelling never fails because the species model is missing

    try:
        ids = survey_results.apply_label(db, body.survey_id, body.track_ids, body.action, body.species,
                                         body.invertebrate_type, body.use_as_reference, body.by,
                                         int(body.frame_id) if body.frame_id else None, body.box, add_reference)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except LookupError as e:
        raise HTTPException(404, str(e))
    return LabelResult(label_ids=[str(i) for i in ids],
                       remaining=survey_results.unknowns(db, body.survey_id).remaining)


@app.delete("/labels/{label_id}", response_model=LabelResult, tags=["labels"])
def undo_label(label_id: int):
    survey_id = db.undo_label(label_id)
    if survey_id is None:
        raise HTTPException(404, "No such label (or it was already undone)")
    return LabelResult(label_ids=[], remaining=survey_results.unknowns(db, survey_id).remaining)


# ── Evaluation: the AI against hand counts ──

@app.post("/surveys/{survey_id}/evaluation", response_model=EvaluationOut, tags=["results"])
def evaluate_survey(survey_id: int, body: EvaluationIn):
    """Compare the AI's point counts with hand counts (a CSV on this computer, or points staff reviewed)."""
    info = _survey_or_404(survey_id)
    if body.path and not Path(body.path).is_file():
        raise HTTPException(400, f"Can't find {Path(body.path).name}.")
    try:
        return survey_results.evaluate(db, survey_id, info.threshold, body.path)
    except ValueError as e:
        raise HTTPException(400, str(e))
