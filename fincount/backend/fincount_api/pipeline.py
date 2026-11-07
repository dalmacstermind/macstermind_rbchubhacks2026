"""The analysis job: footage → pictures → fish detector → species → database.

Real pipeline (when the model files are in the models folder): the vision work happens in
`aquavision` (analyse.py: frames → detect → track → species → clarity); this file only runs it
as a background job, saves the pictures and writes the results to the database.

Demo mode (no model files): the old stub below still runs, and the app shows "Demo mode" so
sample results are never presented as live inference (CLAUDE.md, hard constraint 7).
"""
import random
import shutil
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterator

import cv2
import numpy as np

from aquavision import device
from aquavision.analyse import IMAGE_EXT as AV_IMAGE_EXT
from aquavision.analyse import Analyser, Cancelled, FileResult, read_image
from aquavision.config import (AppConfig, ConfigError, ProtocolConfig, VisionConfig, load_app_config,
                               load_protocol_config, load_vision_config)
from aquavision.ingest import recorded_date, transect_stat
from aquavision.detect import CfdDetector, ModelMissingError
from aquavision.species import BioClipEncoder, ReferenceIndex, crop_box, match

from .db import Database
from .schemas import AnalysisRequest, Box, FileStatus, Job, ModelStatus, Reidentified

SAMPLE_DIR = Path(__file__).parent / "sample"
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}
VIDEO_EXT = {".mp4", ".mov", ".avi", ".mkv"}


@dataclass
class Picture:
    path: Path  # JPG saved in the survey folder (shown to staff in "Check the fish")
    timestamp: str  # "00:01:47" for video, "Photo" for photos
    clarity: float | None = None  # 0–100 water-clarity estimate for this picture (see TODO 3)


# ─────────────────────────────── TODO 1 ───────────────────────────────
def extract_pictures(src: Path, out_dir: Path, prefix: str, fps: int, enhance: bool,
                     on_progress: Callable[[float], None]) -> Iterator[Picture]:
    """Turn one video or photo into pictures saved as JPGs in out_dir.

    Real version (suggestion): OpenCV — open with cv2.VideoCapture, keep one frame every
    (video_fps / fps) frames, if `enhance` apply CLAHE on the L channel of LAB colour space,
    cv2.imwrite each picture, call on_progress(fraction_done) as you go.
    """
    if src.suffix.lower() in IMAGE_EXT:
        dest = out_dir / f"{prefix}_00001{src.suffix.lower()}"
        shutil.copyfile(src, dest)
        on_progress(1.0)
        yield Picture(dest, "Photo")
        return
    # DEMO: pretend the video contained the three sample pictures.
    samples = sorted(SAMPLE_DIR.glob("frame*.jpg"))
    for i, sample in enumerate(samples):
        time.sleep(0.6)  # simulate work so the progress screen is visible
        dest = out_dir / f"{prefix}_{i + 1:05d}.jpg"
        shutil.copyfile(sample, dest)
        _DEMO_PICTURES[str(dest)] = i + 1  # DEMO: remember which sample this is
        on_progress((i + 1) / len(samples))
        yield Picture(dest, ["00:00:12", "00:01:47", "00:03:05"][i], clarity=[72, 38, 81][i])


# ─────────────────────────────── TODO 2 ───────────────────────────────
def detect_fish(picture: Path) -> list[tuple[str, float, Box]]:
    """Find fish in one picture. Return (species_id, confidence 0–1, box in % of the picture).

    species_id must be an id from the species list (e.g. "cod"), or "unknown" when the model
    only knows "fish" — staff name those in "Check the fish".

    Real version (suggestion): onnxruntime.InferenceSession("fish.onnx"), letterbox the picture
    to 640×640, run it, decode YOLO boxes (+ NMS for YOLOv8/11 output), convert to percentages.
    Keep low-confidence boxes (≥ 0.2): the app sets them aside for staff to check.
    """
    sample = SAMPLE_DETECTIONS.get(_DEMO_PICTURES.get(str(picture), 0))
    if sample:
        return [(sp, c, Box(x=x, y=y, w=w, h=h)) for sp, c, x, y, w, h in sample]
    rnd = random.Random(picture.name)
    return [(rnd.choice(["cod", "cunner", "bass", "unknown"]), round(rnd.uniform(0.3, 0.95), 2),
             Box(x=rnd.uniform(5, 60), y=rnd.uniform(10, 60), w=rnd.uniform(15, 30), h=rnd.uniform(10, 20)))
            for _ in range(rnd.randint(1, 3))]


# ─────────────────────────────── TODO 3 ───────────────────────────────
def estimate_clarity(picture: Path) -> float | None:
    """Optional: 0–100 estimate of how clear the water is in this picture (100 = crystal clear).

    Used by the Trends screen to check whether fewer species is really fewer fish or just murkier
    water. Suggestion: RMS contrast or Laplacian variance of the greyscale picture, scaled to 0–100.
    It's an image-based estimate, not turbidity. Return None if you can't measure it.
    """
    return None


class Vision:
    """The real models, created once and kept (CLAUDE.md: never reload per frame or request).

    Loading is lazy (first analysis or reference picture) so the API answers /health quickly.
    """

    def __init__(self, cfg: VisionConfig | None = None, detector=None, encoder=None):
        self.cfg = cfg
        self.error = ""
        if self.cfg is None:
            try:
                self.cfg = load_vision_config()
            except ConfigError as e:
                self.error = str(e)
        self._detector = detector
        self._encoder = encoder
        self.lock = threading.Lock()

    @property
    def installed(self) -> bool:
        """True when the fish detector's weights are on disk (otherwise: demo mode)."""
        return self._detector is not None or (self.cfg is not None and self.cfg.detect.checkpoint.is_file())

    @property
    def species_installed(self) -> bool:
        return self._encoder is not None or (self.cfg is not None and (self.cfg.species.model_dir /
                                                                        "open_clip_config.json").is_file())

    @property
    def encoder_name(self) -> str:
        return getattr(self._encoder, "name", "BioCLIP 2")

    def detector(self):
        with self.lock:
            if self._detector is None:
                self._detector = CfdDetector(self.cfg.detect)
            return self._detector.load() if hasattr(self._detector, "load") else self._detector

    def encoder(self):
        """The species model, or None when it isn't installed (species then stay "Unknown")."""
        if not self.species_installed:
            return None
        with self.lock:
            if self._encoder is None:
                self._encoder = BioClipEncoder(self.cfg.species)
            return self._encoder.load() if hasattr(self._encoder, "load") else self._encoder

    def analyser(self) -> Analyser:
        return Analyser(self.cfg, self.detector(), self.encoder())

    def status(self, references: int) -> ModelStatus:
        mode = device.mode()
        if not self.installed:
            why = self.error or "The fish detector files aren't in the models folder yet"
            return ModelStatus(ready=True, demo=True, name="Demo mode", device=mode, gpu=device.gpu_name() or "",
                               message=f"{why}, so results are sample data.")
        species = self.encoder_name if self.species_installed else ""
        msg = (f"Fish detector: Community Fish Detector (RF-DETR). Species: {species or 'not installed'}"
               f" with {references} reference picture{'s' if references != 1 else ''}.")
        if species and not references:
            msg += " Add reference pictures in Species so fish can be identified."
        return ModelStatus(ready=True, demo=False, name="Community Fish Detector + BioCLIP 2" if species else
                           "Community Fish Detector", message=msg, device=mode, gpu=device.gpu_name() or "",
                           species_model=species, references=references)


VISION = Vision()


def set_vision(v: Vision) -> None:
    """Test hook: swap in a Vision with test models."""
    global VISION
    VISION = v


def model_status(db: Database | None = None) -> ModelStatus:
    """Whether the real models are installed, GPU/CPU mode, and how many reference pictures exist."""
    refs = len(db.reference_vectors(VISION.encoder_name)) if db is not None else 0
    return VISION.status(refs)


SPECK_AREA_PCT2 = 30  # boxes under 0.3% of the picture (30 in %×%) are specks when "ignore specks" is on


def species_for(label: str, registry: set[str]) -> str:
    """The species id a detection starts with: the AI's species, or "unknown"."""
    return label if label in registry else "unknown"


def _to_percent(box: tuple[float, float, float, float], w: int, h: int) -> Box:
    x1, y1, x2, y2 = box
    return Box(x=100 * x1 / w, y=100 * y1 / h, w=100 * (x2 - x1) / w, h=100 * (y2 - y1) / h)


def _save_jpg(img: np.ndarray, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise RuntimeError("A picture couldn't be saved.")
    buf.tofile(str(path))  # tofile works with non-ASCII folder names on Windows
    return path


# ── Species reference pictures ──

def _need_species_model():
    enc = VISION.encoder() if VISION.cfg is not None else None
    if enc is None:
        raise ModelMissingError("The species model (BioCLIP 2) isn't installed, so reference pictures can't be "
                                "used yet. Ask the integration team to add it to the models folder.")
    return enc


def add_reference_pictures(db: Database, data_dir: Path, species_id: str, paths: list[str], by: str) -> int:
    """Add pictures from this computer as references for one species. Returns how many were added."""
    enc = _need_species_model()
    out_dir = data_dir / "references" / species_id
    added = 0
    for p in paths:
        src = Path(p)
        img = read_image(src)  # raises a plain-English error for unreadable files
        h, w = img.shape[:2]
        if w > 1024:
            img = cv2.resize(img, (1024, round(h * 1024 / w)), interpolation=cv2.INTER_AREA)
        dest = _save_jpg(img, out_dir / f"{uuid.uuid4().hex}.jpg")
        db.add_reference(species_id, dest, enc.encode([img])[0], VISION.encoder_name, src.name, by)
        added += 1
    return added


def add_reference_from_detection(db: Database, data_dir: Path, species_id: str, detection_id: int, by: str) -> None:
    """Use a checked fish's crop as a reference picture ("Use as reference image")."""
    enc = _need_species_model()
    found = db.detection_crop_source(detection_id)
    if not found:
        raise FileNotFoundError("That fish isn't in the database any more.")
    picture, box = found
    img = read_image(picture)
    h, w = img.shape[:2]
    pad = VISION.cfg.species.crop_padding
    crop = crop_box(img, (box.x * w / 100, box.y * h / 100, (box.x + box.w) * w / 100, (box.y + box.h) * h / 100),
                    pad, 8)
    if crop is None:
        raise ValueError("That fish is too small to use as a reference picture.")
    dest = _save_jpg(crop, data_dir / "references" / species_id / f"{uuid.uuid4().hex}.jpg")
    db.add_reference(species_id, dest, enc.encode([crop])[0], VISION.encoder_name, f"Checked fish {detection_id}", by)


def reidentify(db: Database, survey_id: int) -> Reidentified:
    """Match every fish of a survey again against the current reference pictures (no re-detection)."""
    if VISION.cfg is None or not VISION.species_installed:
        raise ModelMissingError("The species model (BioCLIP 2) isn't installed.")
    index = ReferenceIndex.build(db.reference_vectors(VISION.encoder_name))
    registry = {s.id for s in db.list_species()}
    changed = 0
    tracks = db.track_vectors(survey_id)
    for track_id, vec in tracks.items():
        r = match(vec, index, VISION.cfg.species)
        changed += db.set_track_species(survey_id, track_id, species_for(r.label, registry), r.label,
                                        r.top_k, r.novelty, r.reason)
    return Reidentified(tracks=len(tracks), changed=changed)


_DEMO_PICTURES: dict[str, int] = {}  # DEMO only: saved picture path → sample number

SAMPLE_DETECTIONS = {  # boxes for the three sample pictures (species, confidence, x, y, w, h)
    1: [("cod", 0.94, 4, 25, 47, 27), ("cunner", 0.81, 55, 47, 22, 17), ("cod", 0.62, 36, 10, 25, 16),
        ("unknown", 0.41, 56, 33, 13, 9)],
    2: [("bass", 0.89, 13, 37, 30, 30), ("pickerel", 0.77, 53, 31, 34, 19), ("trout", 0.48, 9, 23, 22, 11)],
    3: [("mackerel", 0.91, 1, 8, 30, 20), ("mackerel", 0.88, 37, 42, 21, 9), ("mackerel", 0.84, 59, 48, 17, 7),
        ("flounder", 0.73, 56, 74, 34, 16)],
}


# ──────────────────── Job runner (no changes needed) ────────────────────

@dataclass
class _JobState:
    job: Job
    cancel: threading.Event = field(default_factory=threading.Event)


class Jobs:
    def __init__(self, db: Database, data_dir: Path):
        self.db, self.data_dir = db, data_dir
        self.jobs: dict[str, _JobState] = {}
        self.lock = threading.Lock()

    def surveys_dir(self) -> Path:
        return self.data_dir / "surveys"

    def start(self, req: AnalysisRequest) -> Job:
        with self.lock:
            if any(s.job.state == "running" for s in self.jobs.values()):
                raise RuntimeError("An analysis is already running.")
            missing = [f for f in req.files if not Path(f).is_file()]
            if missing:
                raise FileNotFoundError(f"Can't find: {', '.join(missing)}")
            names = [Path(f).name for f in req.files]
            survey_id = self.db.create_survey(req.site.strip() or "Untitled survey", req.environment,
                                              req.threshold, names, req.survey_date, req.person)
            files = [FileStatus(name=n, state="waiting") if Path(f).suffix.lower() in IMAGE_EXT | VIDEO_EXT
                     else FileStatus(name=n, state="skipped", detail="Not a video or photo")
                     for f, n in zip(req.files, names)]
            job = Job(job_id=uuid.uuid4().hex, survey_id=survey_id, state="running", percent=0, stage=0,
                      detail="Getting ready…", files=files)
            state = self.jobs[job.job_id] = _JobState(job)
        threading.Thread(target=self._run, args=(state, req), daemon=True).start()
        return job

    def get(self, job_id: str) -> Job | None:
        s = self.jobs.get(job_id)
        return s.job if s else None

    def cancel(self, job_id: str) -> bool:
        s = self.jobs.get(job_id)
        if s:
            s.cancel.set()
        return bool(s)

    def _run(self, state: _JobState, req: AnalysisRequest):
        job = state.job
        out_dir = self.surveys_dir() / str(job.survey_id)
        out_dir.mkdir(parents=True, exist_ok=True)

        def update(percent: float, stage: int, detail: str):
            job.percent, job.stage, job.detail = int(percent), stage, detail

        try:
            if VISION.installed:
                self._run_real(state, req, out_dir, update)
                return
            n = len(req.files)
            for i, (f, status) in enumerate(zip(req.files, job.files)):
                if status.state == "skipped":
                    continue
                src, base, span = Path(f), i / n * 95, 95 / n
                found = pictures = 0
                status.state = "working"

                def progress(fr: float):
                    stage = 0 if fr < 0.05 else 1 if req.enhance and fr < 0.15 else 2 if fr < 0.9 else 3
                    update(base + fr * span, stage, f"{src.name}: {found} possible fish so far")

                update(base, 0, f"Opening {src.name}")
                try:
                    for pic in extract_pictures(src, out_dir, f"f{i + 1}", req.sampling, req.enhance, progress):
                        if state.cancel.is_set():
                            raise InterruptedError
                        dets = detect_fish(pic.path)
                        if req.ignore_specks:
                            dets = [d for d in dets if d[2].w * d[2].h >= 30]  # < 0.3% of the picture = speck
                        found += len(dets)
                        pictures += 1
                        clarity = pic.clarity if pic.clarity is not None else estimate_clarity(pic.path)
                        self.db.add_frame(job.survey_id, src.name, pic.timestamp, str(pic.path), dets, clarity)
                    status.state = "done"
                    status.detail = f"{pictures} picture{'s' if pictures != 1 else ''} · {found} possible fish"
                except InterruptedError:
                    raise
                except Exception as e:  # one bad file never stops the rest of the batch
                    status.state, status.detail = "failed", str(e) or e.__class__.__name__
            if not any(fs.state == "done" for fs in job.files):
                raise RuntimeError("None of the files could be read. "
                                   + "; ".join(f"{fs.name}: {fs.detail}" for fs in job.files if fs.detail))
            update(97, 4, "Writing the report")
            self.db.set_survey_status(job.survey_id, "done")
            update(100, 4, "Done")
            job.state = "done"
        except InterruptedError:
            self._discard(job, out_dir)
            job.state = "cancelled"
        except Exception as e:  # shown to staff on the start screen
            self._discard(job, out_dir)
            job.state, job.error = "failed", str(e)

    def _store_result(self, survey_id: int, src: Path, res: FileResult, req: AnalysisRequest, registry: set[str],
                      out_dir: Path, video_id: int | None) -> tuple[int, int, int]:
        """Save one file's pictures, boxes and track embeddings. Returns (pictures, boxes, organisms)."""
        for tid, vec in res.track_vectors.items():
            crop = res.track_crops.get(tid)
            crop_path = str(_save_jpg(crop, out_dir / "crops" / f"{tid}.jpg")) if crop is not None else ""
            self.db.save_track_vectors(survey_id, tid, vec, crop_path)
        for tid, crop in res.track_crops.items():  # crops of tracks without embeddings (no species model)
            if tid not in res.track_vectors:
                _save_jpg(crop, out_dir / "crops" / f"{tid}.jpg")
        found, kept_tracks = 0, set()
        for pic in res.pictures:
            rows = []
            for d in pic.detections:
                box = _to_percent(d.box, pic.width, pic.height)
                if req.ignore_specks and box.w * box.h < SPECK_AREA_PCT2:
                    continue
                sr = res.species[d.track_id]
                rows.append((species_for(sr.label, registry), round(d.conf, 3), box,
                             {"track_id": d.track_id, "ai_label": sr.label, "top_k": sr.top_k,
                              "novelty": sr.novelty, "unknown_reason": sr.reason}))
            found += len(rows)
            kept_tracks.update(r[3]["track_id"] for r in rows)
            self.db.add_frame(survey_id, src.name, pic.timestamp, str(pic.image_path), rows, pic.clarity,
                              video_id=video_id, point_no=pic.point_no, t_s=pic.t_s, role=pic.role)
        return len(res.pictures), found, len(kept_tracks)

    def _run_real(self, state: _JobState, req: AnalysisRequest, out_dir: Path, update):
        """The real pipeline (aquavision) for every file of the survey. One bad file never stops the rest.

        Videos: protocol analysis window, subsample points (with context clips) and the richness scan.
        Images: detected and identified on their own; never part of MeanCount.
        """
        job = state.job
        protocol, app_cfg = load_protocol_config(), load_app_config()  # snapshot for this survey
        update(0, 0, "Loading the fish detector and species model")
        try:
            analyser = VISION.analyser()
        except ModelMissingError as e:
            raise RuntimeError(str(e)) from None
        index = ReferenceIndex.build(self.db.reference_vectors(VISION.encoder_name))
        registry = {s.id for s in self.db.list_species()}
        n = len(req.files)
        for i, (f, status) in enumerate(zip(req.files, job.files)):
            if status.state == "skipped":
                continue
            src, base, span, key = Path(f), i / n * 95, 95 / n, f"f{i + 1}"
            status.state = "working"

            def progress(fr: float, src=src, base=base, span=span):
                stage = 0 if fr < 0.02 else 2 if fr < 0.9 else 3
                update(base + fr * span, stage, f"{src.name}: {int(fr * 100)}%")

            update(base, 0, f"Opening {src.name}")
            save = (lambda img, name, key=key: _save_jpg(img, out_dir / f"{key}_{name}.jpg"))
            try:
                if src.suffix.lower() in AV_IMAGE_EXT:
                    res = analyser.analyse_image(src, key, enhance=req.enhance, index=index, save_picture=save,
                                                 on_progress=progress, cancelled=state.cancel.is_set)
                    pics, found, fish = self._store_result(job.survey_id, src, res, req, registry, out_dir, None)
                    status.detail = f"Photo · {found} box{'es' if found != 1 else ''}"
                else:
                    res = analyser.analyse_video(src, key, protocol=protocol, app=app_cfg,
                                                 clip_dir=out_dir / "clips" / key, enhance=req.enhance, index=index,
                                                 save_picture=save, on_progress=progress,
                                                 cancelled=state.cancel.is_set)
                    transect, stat = transect_stat(f)
                    when = recorded_date(f)
                    w = res.window
                    video_id = self.db.add_video(job.survey_id, key, src.name, str(src), w.duration_s, w.fps,
                                                 w.start_s, w.end_s, w.note,
                                                 when.isoformat() if when else req.survey_date, transect or "",
                                                 stat or "")
                    for pt in res.points:
                        self.db.add_point(video_id, pt.point_no, pt.timestamp_s, str(pt.clip_path or ""))
                    pics, found, fish = self._store_result(job.survey_id, src, res, req, registry, out_dir, video_id)
                    status.detail = (f"{len(res.points)} point{'s' if len(res.points) != 1 else ''} · "
                                     f"{pics} pictures · {fish} tracked organism{'s' if fish != 1 else ''}"
                                     + (" · shorter than the protocol window" if w.note else ""))
                status.state = "done"
            except Cancelled:
                raise InterruptedError from None
            except Exception as e:  # one bad file never stops the rest of the batch
                status.state, status.detail = "failed", str(e) or e.__class__.__name__
        if not any(fs.state == "done" for fs in job.files):
            raise RuntimeError("None of the files could be read. "
                               + "; ".join(f"{fs.name}: {fs.detail}" for fs in job.files if fs.detail))
        update(97, 4, "Writing the report")
        self.db.set_survey_status(job.survey_id, "done")
        update(100, 4, "Done")
        job.state = "done"

    def _discard(self, job: Job, out_dir: Path):
        self.db.delete_survey(job.survey_id)
        shutil.rmtree(out_dir, ignore_errors=True)
