"""Vision pipeline for one file (used by the background job in tide_api/pipeline.py).

Videos follow the protocol (CLAUDE.md, Protocol rules):
  1. Analysis window: only a window a person confirmed (protocol.AnalysisWindow, US-2.1) is used.
  2. Subsample points every subsample.interval_s inside the window (protocol.py). For each point,
     only its ±subsample.context_s range is decoded (detect.context_fps pictures per second, the
     point's own moment always included), detected and tracked with its own tracker, and its
     context clip is saved. Counting at the point (±count.tolerance_s) happens in count.py.
  3. Species richness: a sparse scan of the whole window at richness.scan_fps.
Images: the image itself, once (never tracked, never in MeanCount).

Species are decided per tracked organism, not per picture: the best few crops of each track are
embedded with BioCLIP 2 and matched against the registry's reference pictures.
"""
from __future__ import annotations

import logging
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from .clarity import clarity_index
from .clips import save_clip
from .config import AppConfig, ProtocolConfig, VisionConfig
from .detect import Detection, Detector
from .frames import iter_sampled_frames, probe_video
from .protocol import AnalysisWindow, _require_confirmed, context_range, plan_subsample_points
from .species import ReferenceIndex, SpeciesResult, crop_box, match
from .track import VideoTracker, image_tracks

log = logging.getLogger(__name__)

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}
VIDEO_EXT = {".mp4", ".mov", ".avi", ".mkv"}
CROPS_PER_TRACK = 5  # best crops kept per organism for species ID


class Cancelled(Exception):
    pass


@dataclass
class Picture:
    image_path: Path  # JPG saved for staff ("Check the fish"); pictures are never kept in memory
    width: int
    height: int
    frame_idx: int
    t_s: float
    timestamp: str  # "00:01:47" for video, "Photo" for images
    clarity: float | None
    detections: list[Detection] = field(default_factory=list)
    role: str = "photo"  # "point" (a point's context clip) | "scan" (richness scan) | "photo"
    point_no: int | None = None


@dataclass
class PointPlan:
    point_no: int
    timestamp_s: float
    clip_path: Path | None  # None when the clip couldn't be saved (noted, not fatal)


@dataclass
class FileResult:
    pictures: list[Picture]
    species: dict[str, SpeciesResult]  # track_id → result
    track_vectors: dict[str, np.ndarray]  # track_id → crop embeddings (kept for re-identification)
    track_crops: dict[str, np.ndarray]  # track_id → best crop (BGR), for labelling and reference pictures
    window: AnalysisWindow | None = None  # videos only
    points: list[PointPlan] = field(default_factory=list)  # videos only


@dataclass
class _TrackCrops:
    crops: list[tuple[float, np.ndarray]] = field(default_factory=list)  # (quality, crop)

    def add(self, quality: float, crop: np.ndarray) -> None:
        self.crops.append((quality, crop))
        self.crops.sort(key=lambda qc: -qc[0])
        del self.crops[CROPS_PER_TRACK:]


def read_image(path: Path) -> np.ndarray:
    """Read an image from a local path (works with non-ASCII folder names on Windows)."""
    data = np.fromfile(str(path), dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR) if data.size else None
    if img is None:
        raise ValueError(f"{path.name} can't be opened as a picture. It may be damaged.")
    return img


def hhmmss(t: float) -> str:
    t = int(round(t))
    return f"{t // 3600:02d}:{t % 3600 // 60:02d}:{t % 60:02d}"


def _fit(img: np.ndarray, max_width: int) -> np.ndarray:
    h, w = img.shape[:2]
    if w <= max_width:
        return img
    return cv2.resize(img, (max_width, round(h * max_width / w)), interpolation=cv2.INTER_AREA)


def _crop_quality(img: np.ndarray, d: Detection) -> float:
    """Bigger, more confident, sharper crops identify better."""
    x1, y1, x2, y2 = (int(v) for v in d.box)
    patch = cv2.cvtColor(img[max(0, y1):y2, max(0, x1):x2], cv2.COLOR_BGR2GRAY)
    sharp = float(cv2.Laplacian(patch, cv2.CV_64F).var()) if patch.size else 0.0
    area = max(1.0, (x2 - x1) * (y2 - y1))
    return d.conf * np.sqrt(area) * (1 - np.exp(-sharp / 100))


class Analyser:
    """Runs the vision models over one file. Models are created once and reused for every file."""

    def __init__(self, cfg: VisionConfig, detector: Detector, encoder=None, max_width: int = 1920):
        self.cfg = cfg
        self.detector = detector
        self.encoder = encoder  # BioClipEncoder, or None when the species model isn't installed
        self.max_width = max_width

    # ── shared steps ──

    def _run_pictures(self, sources: Iterable[tuple[int, float, str, np.ndarray]], tracker: VideoTracker | None,
                      image_key: str, enhance: bool, crops: dict[str, _TrackCrops], pictures: list[Picture],
                      save_picture: Callable[[np.ndarray, str], Path], name: Callable[[int], str], role: str,
                      point_no: int | None, keep_empty: bool, cancelled: Callable[[], bool],
                      tick: Callable[[], None]) -> None:
        """Detect (and track) every picture from `sources`, keeping crops for species ID."""
        for n, (frame_idx, t_s, stamp, raw) in enumerate(sources, 1):
            if cancelled():
                raise Cancelled
            img = _fit(raw, self.max_width)
            dets = self.detector.detect(img, frame_idx, t_s, enhance=enhance)
            dets = tracker.update(dets) if tracker else image_tracks(image_key, dets)
            for old, new in (tracker.relinked.items() if tracker else ()):
                if old in crops:  # a first sighting joined a track: move its crops there too
                    for q, c in crops.pop(old).crops:
                        crops.setdefault(new, _TrackCrops()).add(q, c)
            if tracker:
                tracker.relinked.clear()
            for d in dets:
                c = crop_box(img, d.box, self.cfg.species.crop_padding, self.cfg.species.min_crop_px)
                if c is not None:
                    crops.setdefault(d.track_id, _TrackCrops()).add(_crop_quality(img, d), c)
            if dets or keep_empty:
                saved = save_picture(img, name(n))
                pictures.append(Picture(saved, img.shape[1], img.shape[0], frame_idx, t_s, stamp,
                                        clarity_index(img, self.cfg.clarity), dets, role, point_no))
            tick()

    def _identify(self, pictures: list[Picture], crops: dict[str, _TrackCrops], index: ReferenceIndex,
                  cancelled: Callable[[], bool]):
        species: dict[str, SpeciesResult] = {}
        vectors: dict[str, np.ndarray] = {}
        best: dict[str, np.ndarray] = {}
        for tid in sorted({d.track_id for p in pictures for d in p.detections}):
            if cancelled():
                raise Cancelled
            tc = crops.get(tid)
            if tc and tc.crops:
                best[tid] = tc.crops[0][1]
            if self.encoder is None:
                species[tid] = SpeciesResult([], 1.0, "Unknown", "The species model isn't installed.")
                continue
            vec = self.encoder.encode([c for _, c in tc.crops]) if tc else np.zeros((0, 1), np.float32)
            if vec.size:
                vectors[tid] = vec
            species[tid] = match(vec, index, self.cfg.species)
        return species, vectors, best

    # ── images ──

    def analyse_image(self, path: Path, file_key: str, *, enhance: bool, index: ReferenceIndex,
                      save_picture: Callable[[np.ndarray, str], Path], on_progress: Callable[[float], None],
                      cancelled: Callable[[], bool]) -> FileResult:
        pictures: list[Picture] = []
        crops: dict[str, _TrackCrops] = {}
        self._run_pictures([(0, 0.0, "Photo", read_image(path))], None, file_key, enhance, crops, pictures,
                           save_picture, lambda n: "photo", "photo", None, True, cancelled, lambda: None)
        on_progress(0.8)
        species, vectors, best = self._identify(pictures, crops, index, cancelled)
        on_progress(1.0)
        return FileResult(pictures, species, vectors, best)

    # ── videos (protocol) ──

    def analyse_video(self, path: Path, file_key: str, *, window: AnalysisWindow, protocol: ProtocolConfig,
                      app: AppConfig, clip_dir: Path, enhance: bool, index: ReferenceIndex,
                      save_picture: Callable[[np.ndarray, str], Path], on_progress: Callable[[float], None],
                      cancelled: Callable[[], bool]) -> FileResult:
        """Count one video inside a window a person confirmed (refuses any other)."""
        _require_confirmed(window)
        info = probe_video(path)
        plans = plan_subsample_points(file_key, window.start_s, window.end_s, protocol.subsample, clip_dir)
        ctx = protocol.subsample.context_s
        fps = self.cfg.detect.context_fps
        scan_fps = protocol.richness.scan_fps
        total = sum(int(2 * ctx * fps) + 1 for _ in plans) + int((window.end_s - window.start_s) * scan_fps) + 1
        done = 0

        def tick():
            nonlocal done
            done += 1
            on_progress(min(0.9, 0.9 * done / max(1, total)))

        pictures: list[Picture] = []
        crops: dict[str, _TrackCrops] = {}
        points: list[PointPlan] = []
        for p in plans:
            start, end = context_range(p.timestamp_s, ctx, info.duration_s)
            # Start the sampling grid so the point's own moment is one of the pictures read.
            grid_start = p.timestamp_s - int((p.timestamp_s - start) * fps) / fps
            frames = iter_sampled_frames(path, file_key, grid_start, end, fps, preroll_s=app.frames.seek_preroll_s)
            tracker = VideoTracker(f"{file_key}-p{p.point_no}", self.cfg.track, fps)
            self._run_pictures(((f.frame_idx, f.t_s, hhmmss(f.t_s), f.image) for f in frames), tracker,
                               file_key, enhance, crops, pictures, save_picture,
                               lambda n, k=p.point_no: f"p{k:02d}_{n:04d}", "point", p.point_no, True,
                               cancelled, tick)
            clip: Path | None = p.clip_path
            try:
                save_clip(path, start, end, p.clip_path, app.clips, preroll_s=app.frames.seek_preroll_s)
            except Exception as e:  # a missing clip never stops the count; staff can still see the pictures
                log.warning("Context clip for point %s of %s not saved: %s", p.point_no, path.name, e)
                clip = None
            points.append(PointPlan(p.point_no, p.timestamp_s, clip))

        # Species richness: sparse scan of the whole window (only pictures with something in them are kept).
        scan_tracker = VideoTracker(f"{file_key}-scan", self.cfg.track, scan_fps)
        frames = iter_sampled_frames(path, file_key, window.start_s, window.end_s, scan_fps,
                                     preroll_s=app.frames.seek_preroll_s)
        self._run_pictures(((f.frame_idx, f.t_s, hhmmss(f.t_s), f.image) for f in frames), scan_tracker,
                           file_key, enhance, crops, pictures, save_picture, lambda n: f"scan_{n:05d}", "scan",
                           None, False, cancelled, tick)
        species, vectors, best = self._identify(pictures, crops, index, cancelled)
        on_progress(1.0)
        return FileResult(pictures, species, vectors, best, window, points)
