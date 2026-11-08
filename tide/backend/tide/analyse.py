"""Vision pipeline for one file (used by the background job in tide_api/pipeline.py).

Videos follow the protocol (CLAUDE.md, Protocol rules):
  1. Analysis window: only a window a person confirmed (protocol.AnalysisWindow, US-2.1) is used.
  2. Subsample points every subsample.interval_s inside the window (protocol.py). For each point,
     only its ±subsample.context_s range is decoded (detect.context_fps pictures per second, the
     point's own moment always included), detected and tracked with its own tracker, and its
     context clip is saved. Counting at the point (±count.tolerance_s) happens in count.py.
  3. Species richness: a sparse scan of the whole window at richness.scan_fps.
Images: the image itself, once (never tracked, never in MeanCount).

One organism is counted once: pieces of a track are joined (track.merge_fragments), motion finds of a
fish the detector also boxed join the detector's track, and things fixed in view for the whole video
(the survey pole, its markings, rocks) are removed before species ID (fixed.py).

Species are decided per tracked organism, not per picture: the best few crops of each track are
embedded with BioCLIP 2 and matched against the registry's reference pictures.
"""
from __future__ import annotations

import logging
from concurrent.futures import Future, ThreadPoolExecutor
import math
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from .clarity import clarity_index
from .clips import save_clip
from .config import AppConfig, ProtocolConfig, VisionConfig
from .detect import Detection, Detector, nms
from .frames import iter_sampled_frames, probe_video
from .drift import DriftFilter
from .motion import find_moving_objects, small_grey
from .quality import QualityResult, assess
from .static_filter import StaticFilter
from .protocol import (AnalysisWindow, _require_confirmed, context_range, plan_short_window_points,
                       plan_subsample_points)
from .species import ReferenceIndex, SpeciesResult, crop_box, match
from .fixed import find_fixed, on_fixed
from .track import VideoTracker, image_tracks, merge_fragments

log = logging.getLogger(__name__)

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}
VIDEO_EXT = {".mp4", ".mov", ".avi", ".mkv"}
CROPS_PER_TRACK = 5  # best crops kept per organism for species ID
# Share of the progress bar for searching the pictures; species ID takes most of the rest. Measured on
# the GTX 1650 Ti: species ID is about a third of the time, so a steady bar gives a fair time left.
SEARCH_SHARE = 0.65
IDENTIFY_CHUNK = 128  # crops per species-model call (progress is reported between calls)
CROPS_PER_MOTION_TRACK = 2  # motion-only finds are small blobs: more crops cost time, not accuracy


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
    quality: str = ""  # "clear" | "moderate" | "muddy" | "obscured" (quality.py)
    quality_score: float | None = None
    quality_reasons: str = ""
    static: bool = False  # same as the last searched picture: its boxes were carried over


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
    drifting: set[str] = field(default_factory=set)  # tracks moving like the water (drift.py)


@dataclass
class _TrackCrops:
    crops: list[tuple[float, np.ndarray]] = field(default_factory=list)  # (quality, crop)
    limit: int = CROPS_PER_TRACK

    def add(self, quality: float, crop: np.ndarray) -> None:
        self.crops.append((quality, crop))
        self.crops.sort(key=lambda qc: -qc[0])
        del self.crops[self.limit:]


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

    def __init__(self, cfg: VisionConfig, detector: Detector, encoder=None, max_width: int = 1920,
                 look_closer: bool = False, tracker: str | None = None):
        self.cfg = cfg
        self.detector = detector
        self.encoder = encoder  # BioClipEncoder, or None when the species model isn't installed
        self.max_width = max_width
        self.look_closer = look_closer  # tiled search on the full-resolution picture (slower)
        self.tracker = tracker  # "bytetrack" | "ocsort" (None: app.yaml track.tracker)

    def _detect(self, raw: np.ndarray, img: np.ndarray, frame_idx: int, t_s: float, enhance: bool,
                close: bool = False):
        """Detections in `img` (the picture staff see).

        close (the moments that are counted) or look_closer (every picture): the whole picture, plus
        the full-resolution picture in detector-sized tiles (detect.detect_close), merged so that one
        fish keeps one box.
        """
        dets = self.detector.detect(img, frame_idx, t_s, enhance=enhance)
        tiled = getattr(self.detector, "detect_close", None)
        if not (close or self.look_closer) or tiled is None:
            return dets
        more = tiled(raw, img.shape[1] / raw.shape[1], frame_idx, t_s, enhance=enhance)
        both = dets + more
        if not both:
            return []
        boxes = np.asarray([d.box for d in both], np.float32)
        scores = np.asarray([d.conf for d in both], np.float32)
        return [both[i] for i in nms(boxes, scores, self.cfg.detect.nms_iou, self.cfg.detect.contain)]

    # ── shared steps ──

    def _run_pictures(self, sources: Iterable[tuple[int, float, str, np.ndarray]], tracker: VideoTracker | None,
                      image_key: str, enhance: bool, crops: dict[str, _TrackCrops], pictures: list[Picture],
                      save_picture: Callable[[np.ndarray, str], Path], name: Callable[[int], str], role: str,
                      point_no: int | None, keep_empty: bool, cancelled: Callable[[], bool],
                      tick: Callable[[], None], drift: DriftFilter | None = None,
                      seen: dict[int, tuple[QualityResult, list[Detection], bool]] | None = None,
                      close_at: Callable[[float], bool] | None = None) -> None:
        """Detect (and track) every picture from `sources`, keeping crops for species ID.

        Per picture: quality check → the cleared-up picture is only searched when
        the picture isn't clear → static pictures reuse the last boxes → detector → tracker → drift.
        seen: pictures already searched in this video (by frame number). Points close together share
        pictures (a short video's context windows overlap), and each picture is only searched once.
        close_at(t_s): this picture is counted, so it gets the close search too (never skipped as static).
        """
        static = StaticFilter(self.cfg.static_filter) if tracker else None
        last: list[Detection] = []
        for n, (frame_idx, t_s, stamp, raw) in enumerate(sources, 1):
            if cancelled():
                raise Cancelled
            img = _fit(raw, self.max_width)
            close = bool(close_at and close_at(t_s))
            known = seen.get(frame_idx) if seen is not None else None
            if known and close and not known[2]:
                known = None  # searched before without the close search: search it again, closely
            qual = known[0] if known else assess(img, self.cfg.quality)
            is_static = bool(not known and static and static.is_static(img, t_s)) and not close
            if known:  # searched already for an overlapping point: same boxes, new track ids
                dets = [Detection(frame_idx, t_s, d.box, d.cls, d.conf, None) for d in known[1]]
            elif is_static:  # same picture as before: carry the boxes over (the tracker keeps the same fish)
                dets = [Detection(frame_idx, t_s, d.box, d.cls, d.conf, None) for d in last]
            else:
                dets = self._detect(raw, img, frame_idx, t_s, enhance and qual.degraded, close)
            if seen is not None and not known:
                seen[frame_idx] = (qual, [Detection(frame_idx, t_s, d.box, d.cls, d.conf, None) for d in dets], close)
            last = dets
            dets = tracker.update(dets) if tracker else image_tracks(image_key, dets)
            if drift is not None:
                drift.add(img, {d.track_id: d.box for d in dets})
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
                                        clarity_index(img, self.cfg.clarity), dets, role, point_no, qual.category,
                                        qual.score, ", ".join(qual.reasons), is_static))
            tick()

    def _add_moving_fish(self, pictures: list[Picture], greys: list[np.ndarray], key: str,
                         crops: dict[str, _TrackCrops]) -> None:
        """Add fish found by motion (motion.py) that the detector didn't already box."""
        found = find_moving_objects(greys, self.cfg.motion)
        if found.skipped_reason:
            log.info("%s: %s", key, found.skipped_reason)
        if not found.boxes or len(greys) != len(pictures):
            return
        images: dict[int, np.ndarray] = {}
        placed = []  # (motion box, picture, box in picture pixels, detector track there or None)
        same: dict[int, str] = {}  # motion track -> the detector's track for the same fish
        for mb in found.boxes:
            pic = pictures[mb.frame_index]
            s = pic.width / self.cfg.motion.work_width
            x1, y1, x2, y2 = (max(0.0, v * s) for v in mb.box)
            x2, y2 = min(x2, pic.width), min(y2, pic.height)
            cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
            hit = next((d.track_id for d in pic.detections
                        if d.box[0] <= cx <= d.box[2] and d.box[1] <= cy <= d.box[3]), None)
            if hit is not None:
                same.setdefault(mb.track, hit)
            placed.append((mb, pic, (x1, y1, x2, y2), hit))
        for mb, pic, (x1, y1, x2, y2), hit in placed:
            if hit is not None:
                continue  # the detector already has this fish
            tid = same.get(mb.track, f"{key}-m{mb.track}")  # seen by the detector elsewhere: the same fish
            if tid in {d.track_id for d in pic.detections}:
                continue  # that fish already has a box in this picture
            d = Detection(pic.frame_idx, pic.t_s, (x1, y1, x2, y2), "fish", self.cfg.motion.confidence, tid)
            pic.detections.append(d)
            if mb.frame_index not in images:
                images[mb.frame_index] = read_image(pic.image_path)
            c = crop_box(images[mb.frame_index], d.box, max(self.cfg.species.crop_padding, 0.5), 4)
            if c is not None and d.track_id not in crops:
                crops[d.track_id] = _TrackCrops(limit=CROPS_PER_MOTION_TRACK)
            if c is not None:
                crops[d.track_id].add(_crop_quality(images[mb.frame_index], d), c)

    def _join_pieces(self, pictures: list[Picture], crops: dict[str, _TrackCrops], drifting: set[str]) -> None:
        """One organism, one track: join the pieces of each track in these pictures (one point or the scan)."""
        joined = merge_fragments([d for p in pictures for d in p.detections], self.cfg.track.merge_gap_s,
                                 self.cfg.track.merge_distance)
        for old, new in joined.items():
            for q, c in crops.pop(old, _TrackCrops()).crops:
                crops.setdefault(new, _TrackCrops()).add(q, c)
            if old in drifting:  # part of it moved like the water: a person checks the whole organism
                drifting.discard(old)
                drifting.add(new)

    def _remove_fixed(self, pictures: list[Picture], searched: dict[int, list[Detection]],
                      crops: dict[str, _TrackCrops]) -> list[Picture]:
        """Remove boxes on things fixed in view for the whole video (fixed.py). Returns the pictures kept."""
        if not pictures:
            return pictures
        fixed = find_fixed(searched, pictures[0].width, self.cfg.fixed_structure)
        if not fixed:
            return pictures
        removed = 0
        for pic in pictures:
            keep = [d for d in pic.detections if not on_fixed(d, fixed, self.cfg.fixed_structure)]
            removed += len(pic.detections) - len(keep)
            pic.detections = keep
        left = {d.track_id for p in pictures for d in p.detections}
        for tid in [t for t in crops if t not in left]:
            del crops[tid]
        kept = []
        for pic in pictures:  # richness-scan pictures are only kept when something is in them
            if pic.role == "scan" and not pic.detections:
                pic.image_path.unlink(missing_ok=True)
            else:
                kept.append(pic)
        log.info("Removed %s boxes on %s fixed things in view (pole, markings, rocks)", removed, len(fixed))
        return kept

    def _identify(self, pictures: list[Picture], crops: dict[str, _TrackCrops], index: ReferenceIndex,
                  cancelled: Callable[[], bool], on_progress: Callable[[float], None] | None = None):
        """Species for every track. on_progress(0–1) reports how many crops have been encoded."""
        species: dict[str, SpeciesResult] = {}
        vectors: dict[str, np.ndarray] = {}
        best: dict[str, np.ndarray] = {}
        tids = sorted({d.track_id for p in pictures for d in p.detections})
        # Every track's crops go through the species model together, in full batches (much faster
        # than one small batch per track), then are split back per track.
        flat = [(tid, c) for tid in tids if self.encoder is not None for _, c in crops.get(tid, _TrackCrops()).crops]
        encoded = None
        if flat:  # in chunks, so progress can be shown (species ID can take a minute)
            parts = []
            for i in range(0, len(flat), IDENTIFY_CHUNK):
                if cancelled():
                    raise Cancelled
                parts.append(self.encoder.encode([c for _, c in flat[i:i + IDENTIFY_CHUNK]]))
                if on_progress:
                    on_progress(min(1.0, (i + IDENTIFY_CHUNK) / len(flat)))
            encoded = np.concatenate(parts)
        rows: dict[str, list[int]] = {}
        for i, (tid, _) in enumerate(flat):
            rows.setdefault(tid, []).append(i)
        for tid in tids:
            if cancelled():
                raise Cancelled
            tc = crops.get(tid)
            if tc and tc.crops:
                best[tid] = tc.crops[0][1]
            if self.encoder is None:
                species[tid] = SpeciesResult([], 1.0, "Unknown", "The species model isn't installed.")
                continue
            vec = encoded[rows[tid]] if tid in rows else np.zeros((0, 1), np.float32)
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
                           save_picture, lambda n: "photo", "photo", None, True, cancelled, lambda: None,
                           close_at=lambda t: self.cfg.detect.close_search)
        on_progress(0.8)
        species, vectors, best = self._identify(pictures, crops, index, cancelled)
        on_progress(1.0)
        return FileResult(pictures, species, vectors, best)

    # ── videos (protocol) ──

    def analyse_video(self, path: Path, file_key: str, *, window: AnalysisWindow, protocol: ProtocolConfig,
                      app: AppConfig, clip_dir: Path, enhance: bool, index: ReferenceIndex,
                      save_picture: Callable[[np.ndarray, str], Path], on_progress: Callable[[float], None],
                      cancelled: Callable[[], bool], short_window: bool = False) -> FileResult:
        """Count one video inside a window a person confirmed (refuses any other).

        short_window: a short video's shorter window, so the points are spread across the clip
        (protocol.short_window_timestamps) instead of every subsample.interval_s.
        """
        _require_confirmed(window)
        info = probe_video(path)
        if short_window:
            plans = plan_short_window_points(file_key, window.start_s, window.end_s, protocol.subsample,
                                             protocol.window.length_s, clip_dir)
        else:
            plans = plan_subsample_points(file_key, window.start_s, window.end_s, protocol.subsample, clip_dir)
        ctx = protocol.subsample.context_s
        fps = self.cfg.detect.context_fps
        scan_fps = protocol.richness.scan_fps
        total = sum(int(2 * ctx * fps) + 1 for _ in plans) + int((window.end_s - window.start_s) * scan_fps) + 1
        done = 0

        def tick():
            nonlocal done
            done += 1
            on_progress(min(SEARCH_SHARE, SEARCH_SHARE * done / max(1, total)))

        pictures: list[Picture] = []
        crops: dict[str, _TrackCrops] = {}
        points: list[PointPlan] = []
        drifting: set[str] = set()
        seen: dict[int, tuple[QualityResult, list[Detection], bool]] = {}  # each picture is searched once
        tol = protocol.count.effective_tolerance_s
        # Context clips are written on the CPU while the GPU searches the next point's pictures.
        clip_writer = ThreadPoolExecutor(max_workers=1, thread_name_prefix="clips")
        clip_jobs: list[tuple[int, Future]] = []
        try:
            for p in plans:
                start, end = context_range(p.timestamp_s, ctx, info.duration_s)
                # One sampling grid for the whole video (from the window start): points whose context overlaps
                # read the same pictures, so each is searched once (seen). Points 60 s apart sit on the grid.
                grid_start = window.start_s + math.ceil(round((start - window.start_s) * fps, 6)) / fps
                frames = iter_sampled_frames(path, file_key, grid_start, end, fps, preroll_s=app.frames.seek_preroll_s)
                tracker = VideoTracker(f"{file_key}-p{p.point_no}", self.cfg.track, fps, self.tracker)
                drift = DriftFilter(self.cfg.drift)
                first = len(pictures)
                greys: list[np.ndarray] = []  # small grey copies for motion detection (stationary camera)

                def source(frames=frames, greys=greys):
                    for f in frames:
                        if self.cfg.motion.enabled:
                            greys.append(small_grey(f.image, self.cfg.motion.work_width))
                        yield f.frame_idx, f.t_s, hhmmss(f.t_s), f.image

                self._run_pictures(source(), tracker, file_key, enhance, crops, pictures, save_picture,
                                   lambda n, k=p.point_no: f"p{k:02d}_{n:04d}", "point", p.point_no, True,
                                   cancelled, tick, drift, seen,
                                   # the pictures this point is counted from get the close search
                                   lambda t, at=p.timestamp_s: self.cfg.detect.close_search
                                   and abs(t - at) <= tol + 1e-6)
                drifting.update(drift.drifting())
                self._add_moving_fish(pictures[first:], greys, f"{file_key}-p{p.point_no}", crops)
                self._join_pieces(pictures[first:], crops, drifting)
                clip_jobs.append((len(points), clip_writer.submit(
                    save_clip, path, start, end, p.clip_path, app.clips, preroll_s=app.frames.seek_preroll_s)))
                points.append(PointPlan(p.point_no, p.timestamp_s, p.clip_path))

            # Species richness: sparse scan of the whole window (only pictures with something in them are kept).
            scan_tracker = VideoTracker(f"{file_key}-scan", self.cfg.track, scan_fps, self.tracker)
            frames = iter_sampled_frames(path, file_key, window.start_s, window.end_s, scan_fps,
                                         preroll_s=app.frames.seek_preroll_s)
            self._run_pictures(((f.frame_idx, f.t_s, hhmmss(f.t_s), f.image) for f in frames), scan_tracker,
                               file_key, enhance, crops, pictures, save_picture, lambda n: f"scan_{n:05d}", "scan",
                               None, False, cancelled, tick, seen=seen)
            self._join_pieces([p for p in pictures if p.role == "scan"], crops, drifting)
            pictures = self._remove_fixed(pictures, {f: v[1] for f, v in seen.items()}, crops)
            species, vectors, best = self._identify(pictures, crops, index, cancelled,
                                                    lambda f: on_progress(SEARCH_SHARE + (0.98 - SEARCH_SHARE) * f))
            clip_writer.shutdown(wait=True)
            for i, job in clip_jobs:
                try:
                    job.result()
                except Exception as e:  # a missing clip never stops the count; staff can still see the pictures
                    log.warning("Context clip for point %s of %s not saved: %s", points[i].point_no, path.name, e)
                    points[i] = PointPlan(points[i].point_no, points[i].timestamp_s, None)
            on_progress(1.0)
            return FileResult(pictures, species, vectors, best, window, points, drifting)
        finally:  # also when stopped: a clip being written finishes before its folder is removed
            clip_writer.shutdown(wait=True)
