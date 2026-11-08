"""Tracking: the same fish across a video's pictures gets one `track_id` (CLAUDE.md, Models).

ByteTrack (MIT) or OC-SORT (MIT), both via Roboflow `trackers` (Apache 2.0): a Kalman motion model
with association on box overlap; OC-SORT adds observation-centric momentum, which helps when fish
turn or are briefly hidden. One fish is then identified (and later counted) once per track, not
once per picture. Detections the tracker does not keep get a track of their own, so nothing is
silently dropped. Images are never tracked (each image detection is its own track).
"""
from __future__ import annotations

from collections.abc import Iterable

import numpy as np

from .config import TrackConfig
from .detect import Detection, box_iou

_TRACKERS_REFERENCE_FPS = 30  # `trackers` measures lost_track_buffer in frames at 30 fps


class VideoTracker:
    """Assigns track ids to the detections of one video, picture by picture in time order."""

    def __init__(self, video_key: str, cfg: TrackConfig, sample_fps: float, tracker: str | None = None):
        self.video_key = video_key
        self.cfg = cfg
        self._next_solo = 0
        self._pending: list[Detection] = []  # last picture's detections the tracker hasn't confirmed yet
        self.relinked: dict[str, str] = {}  # temporary id → track id it turned out to start
        self._tracker = None
        self.name = tracker or cfg.tracker
        if cfg.enabled and self.name == "ocsort":
            import trackers
            self._tracker = trackers.OCSORTTracker(
                lost_track_buffer=max(1, round(cfg.lost_buffer_s * _TRACKERS_REFERENCE_FPS)),
                frame_rate=float(max(0.1, sample_fps)),
                minimum_consecutive_frames=1,
                minimum_iou_threshold=cfg.match_iou,
                high_conf_det_threshold=cfg.activation_threshold,
            )
        elif cfg.enabled:
            import trackers
            self._tracker = trackers.ByteTrackTracker(
                lost_track_buffer=max(1, round(cfg.lost_buffer_s * _TRACKERS_REFERENCE_FPS)),
                frame_rate=float(max(0.1, sample_fps)),
                track_activation_threshold=cfg.activation_threshold,
                high_conf_det_threshold=cfg.activation_threshold,
                minimum_consecutive_frames=1,
                minimum_iou_threshold=cfg.match_iou,
            )

    def update(self, detections: list[Detection]) -> list[Detection]:
        """Sets `track_id` on every detection of one picture and returns them."""
        ids = self._assign(detections) if self._tracker is not None and detections else [-1] * len(detections)
        pending, self._pending = self._pending, []
        for d, tid in zip(detections, ids):
            if tid >= 0:
                d.track_id = f"{self.video_key}-t{tid}"
                self._backfill(d, pending)
            else:
                self._next_solo += 1
                d.track_id = f"{self.video_key}-s{self._next_solo}"
                self._pending.append(d)
        return detections

    def _backfill(self, d: Detection, pending: list[Detection]) -> None:
        """ByteTrack confirms a new fish one picture late: give that first sighting the same track id."""
        best, best_iou = None, self.cfg.match_iou
        for p in pending:
            iou = box_iou(p.box, d.box)
            if iou >= best_iou:
                best, best_iou = p, iou
        if best is not None:
            self.relinked[best.track_id] = d.track_id
            best.track_id = d.track_id
            pending.remove(best)

    def _assign(self, detections: list[Detection]) -> list[int]:
        import supervision as sv
        boxes = np.asarray([d.box for d in detections], dtype=np.float32).reshape(-1, 4)
        scores = np.asarray([d.conf for d in detections], dtype=np.float32)
        dets = sv.Detections(xyxy=boxes, confidence=scores, class_id=np.zeros(len(boxes), dtype=int),
                             data={"det_index": np.arange(len(boxes))})
        res = self._tracker.update(dets, timestamp=detections[0].t_s)
        out = [-1] * len(detections)
        if res is not None and len(res) and res.tracker_id is not None:
            for di, tid in zip(res.data["det_index"], res.tracker_id):
                if tid is not None and int(tid) >= 0:
                    out[int(di)] = int(tid)
        return out


def image_tracks(image_key: str, detections: Iterable[Detection]) -> list[Detection]:
    """Images are not videos: every detection is its own track."""
    out = list(detections)
    for i, d in enumerate(out, 1):
        d.track_id = f"{image_key}-s{i}"
    return out
