"""The analysis pipeline: footage → pictures → fish detector → database.

╔══════════════════════════════════════════════════════════════════════════════╗
║  INTEGRATION TEAM: this file is yours. Right now it is a STUB (demo mode):   ║
║  videos produce three sample pictures with sample fish, and photos get        ║
║  made-up boxes. Replace the functions marked TODO 1–2 (3 is optional);        ║
║  everything else                                                              ║
║  (progress, cancel, database, API) already works.                             ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""
import random
import shutil
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterator

from aquavision.config import AppConfig, ProtocolConfig
from aquavision.frames import probe_video
from aquavision.protocol import WindowProposal, propose_window

from .db import Database
from .schemas import AnalysisRequest, Box, FileStatus, Job, ModelStatus

SAMPLE_DIR = Path(__file__).parent / "sample"
IMAGE_EXT = {".jpg", ".jpeg", ".png"}
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


def model_status() -> ModelStatus:
    """Tell the app whether a real model is loaded. Update when TODO 2 is done."""
    return ModelStatus(ready=True, demo=True, name="Demo mode",
                       message="No fish model connected yet, so results are sample data.")


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
    def __init__(self, db: Database, data_dir: Path, protocol: ProtocolConfig, app: AppConfig):
        self.db, self.data_dir = db, data_dir
        self.protocol, self.app = protocol, app
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
                    proposal = None
                    if src.suffix.lower() in VIDEO_EXT:
                        update(base, 0, f"{src.name}: checking the analysis window")
                        proposal = self._propose_window(job.survey_id, src)
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
                    if proposal is not None:
                        status.detail += (" · too short for the protocol (flagged)" if proposal.too_short
                                          else " · analysis window waiting for confirmation")
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

    def _propose_window(self, survey_id: int, src: Path) -> WindowProposal:
        """Propose the analysis window and store it for staff to confirm. Never confirms it."""
        info = probe_video(src)  # an unreadable video fails here with a plain-English error
        proposal = propose_window(src, self.protocol, self.app)
        self.db.add_video(survey_id, src.name, str(src), info.duration_s, info.fps, proposal)
        return proposal

    def _discard(self, job: Job, out_dir: Path):
        self.db.delete_survey(job.survey_id)
        shutil.rmtree(out_dir, ignore_errors=True)
