"""Picture pipeline for one file: pictures → detect → track → species → clarity.

Used by the background job in fincount_api/pipeline.py (route handlers and the job runner stay
thin; the vision logic lives here). One video or image in, `Picture`s with their fish out.

- Video: one picture every 1/fps seconds (the survey's "sampling"), read in place with OpenCV.
- Image: the image itself, once. Images are never tracked or put into MeanCount.
- Species are decided per tracked fish (not per picture): the best few crops of each track are
  embedded with BioCLIP 2 and matched against the registry, and every detection of that track
  gets the same result. So one fish never gets different species in different pictures.
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from .clarity import clarity_index
from .config import VisionConfig
from .detect import Detection, Detector
from .frames import iter_sampled_frames, probe_video
from .species import ReferenceIndex, SpeciesResult, crop_box, match
from .track import VideoTracker, image_tracks

log = logging.getLogger(__name__)

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}
VIDEO_EXT = {".mp4", ".mov", ".avi", ".mkv"}
CROPS_PER_TRACK = 5  # best crops kept per fish for species ID


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


@dataclass
class FileResult:
    pictures: list[Picture]
    species: dict[str, SpeciesResult]  # track_id → result
    track_vectors: dict[str, np.ndarray]  # track_id → crop embeddings (kept for re-identification)
    track_crops: dict[str, np.ndarray]  # track_id → best crop (BGR), for reference pictures


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

    def analyse(self, path: Path, file_key: str, *, sampling_fps: float, enhance: bool,
                index: ReferenceIndex, save_picture: Callable[[np.ndarray, int], Path],
                on_progress: Callable[[float], None], cancelled: Callable[[], bool]) -> FileResult:
        """Detect, track, identify and measure clarity for one video or image."""
        ext = path.suffix.lower()
        if ext in IMAGE_EXT:
            sources = [(0, 0.0, "Photo", read_image(path))]
            total = 1
            tracker = None
        elif ext in VIDEO_EXT:
            info = probe_video(path)
            total = max(1, int(info.duration_s * sampling_fps) + 1)
            sources = ((f.frame_idx, f.t_s, hhmmss(f.t_s), f.image)
                       for f in iter_sampled_frames(path, file_key, 0.0, info.duration_s, sampling_fps,
                                                    preroll_s=1.0))
            tracker = VideoTracker(file_key, self.cfg.track, sampling_fps)
        else:
            raise ValueError(f"{path.name} isn't a video or picture this app can read.")

        pictures: list[Picture] = []
        crops: dict[str, _TrackCrops] = {}
        for n, (frame_idx, t_s, stamp, raw) in enumerate(sources, 1):
            if cancelled():
                raise Cancelled
            img = _fit(raw, self.max_width)
            dets = self.detector.detect(img, frame_idx, t_s, enhance=enhance)
            dets = tracker.update(dets) if tracker else image_tracks(file_key, dets)
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
            saved = save_picture(img, n)
            pictures.append(Picture(saved, img.shape[1], img.shape[0], frame_idx, t_s, stamp,
                                    clarity_index(img, self.cfg.clarity), dets))
            on_progress(min(0.9, 0.9 * n / total))

        species: dict[str, SpeciesResult] = {}
        vectors: dict[str, np.ndarray] = {}
        best: dict[str, np.ndarray] = {}
        track_ids = {d.track_id for p in pictures for d in p.detections}
        for i, tid in enumerate(sorted(track_ids), 1):
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
            on_progress(0.9 + 0.1 * i / max(1, len(track_ids)))
        on_progress(1.0)
        return FileResult(pictures, species, vectors, best)
