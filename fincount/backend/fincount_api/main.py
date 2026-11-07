"""FinCount API. Runs only on this computer (127.0.0.1); the desktop app starts and stops it.

Interactive docs while it's running: http://127.0.0.1:8765/docs
The contract is described in ../API.md — keep the two in step.
"""
import os
import re
import secrets
import shutil
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from . import __version__
from .db import Database
from aquavision.detect import ModelMissingError

from . import pipeline
from .pipeline import Jobs, model_status
from .schemas import (AnalysisRequest, DetectionPatch, Frame, Health, Job, ModelStatus, Person, QcCountIn, QcData,
                      Reference, ReferenceFromDetection, ReferencesIn, Reidentified, Species, SpeciesIn, SpeciesPatch,
                      Storage, SurveyData, SurveyInfo, SurveyPatch)

DATA_DIR = Path(os.environ.get("FINCOUNT_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
# The desktop app passes a random token so other programs (or web pages) on this PC can't use the API.
# When it's not set (development), no token is needed.
TOKEN = os.environ.get("FINCOUNT_TOKEN", "")

db = Database(DATA_DIR / "fincount.db")
jobs = Jobs(db, DATA_DIR)


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

@app.get("/surveys/{survey_id}/qc", response_model=QcData, tags=["qc"])
def get_qc(survey_id: int, percent: float = Query(10, gt=0, le=100)):
    """The random sample is picked the first time this is called for a survey, then kept."""
    if not db.get_survey(survey_id):
        raise HTTPException(404, "No such survey")
    sample, counts = db.qc(survey_id, percent)
    return QcData(sample=sample, counts=counts)


@app.post("/surveys/{survey_id}/qc", response_model=QcData, tags=["qc"])
def add_qc_count(survey_id: int, body: QcCountIn, percent: float = Query(10, gt=0, le=100)):
    if not db.add_qc_count(survey_id, body):
        raise HTTPException(400, "That picture isn't in this survey's QC sample.")
    sample, counts = db.qc(survey_id, percent)
    return QcData(sample=sample, counts=counts)
