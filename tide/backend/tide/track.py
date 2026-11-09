"""Tracking: the same fish across a video's pictures gets one `track_id` (CLAUDE.md, Models).

ByteTrack (MIT) or OC-SORT (MIT), both via Roboflow `trackers` (Apache 2.0): a Kalman motion model
with association on box overlap; OC-SORT adds observation-centric momentum, which helps when fish
turn or are briefly hidden. One fish is then identified (and later counted) once per track, not
once per picture. Detections the tracker does not keep get a track of their own, so nothing is
silently dropped: they are linked picture to picture by box overlap on their own, so a faint fish
(or a rock) the tracker never confirms is still one organism, not a new one in every picture.
`merge_fragments` then joins the pieces of one fish's track (the tracker lost it for a moment).
Images are never tracked (each image detection is its own track).
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
        # Detections the tracker didn't take, by their own id: (last box, last seen, pictures seen in)
        self._solos: dict[str, tuple[tuple[float, float, float, float], float, int]] = {}
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
        t_now = detections[0].t_s if detections else 0.0
        self._solos = {k: v for k, v in self._solos.items() if t_now - v[1] <= self.cfg.lost_buffer_s}
        taken: set[str] = set()
        for d, tid in zip(detections, ids):
            if tid >= 0:
                d.track_id = f"{self.video_key}-t{tid}"
                self._backfill(d, pending)
            else:
                d.track_id = self._solo_id(d, taken)
                taken.add(d.track_id)
                self._pending.append(d)
        return detections

    def _solo_id(self, d: Detection, taken: set[str]) -> str:
        """Same id as the overlapping unconfirmed detection of a recent picture, else a new one."""
        best, best_iou = None, self.cfg.match_iou
        for sid, (box, _, _) in self._solos.items():
            if sid not in taken:
                iou = box_iou(box, d.box)
                if iou >= best_iou:
                    best, best_iou = sid, iou
        if best is None:
            self._next_solo += 1
            best = f"{self.video_key}-s{self._next_solo}"
        n = self._solos.get(best, (None, 0.0, 0))[2]
        self._solos[best] = (d.box, d.t_s, n + 1)
        return best

    def _backfill(self, d: Detection, pending: list[Detection]) -> None:
        """ByteTrack confirms a new fish one picture late: give that first sighting the same track id."""
        best, best_iou = None, self.cfg.match_iou
        for p in pending:
            if self._solos.get(p.track_id, (None, 0.0, 1))[2] > 1:
                continue  # seen in earlier pictures too: merge_fragments joins the whole piece
            iou = box_iou(p.box, d.box)
            if iou >= best_iou:
                best, best_iou = p, iou
        if best is not None:
            self.relinked[best.track_id] = d.track_id
            self._solos.pop(best.track_id, None)
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


def merge_fragments(detections: list[Detection], max_gap_s: float, max_distance: float) -> dict[str, str]:
    """Join the pieces of one organism's track. Returns {piece id: id it joined} and renames the detections.

    A piece joins an earlier one when it starts after that one ended, within max_gap_s, and its first
    box is no more than max_distance box sizes (the larger side of the earlier box) from the earlier
    piece's last box. Pieces seen at the same moment are never joined (they are two organisms).
    When several could, the nearest wins; the joined track keeps the earliest piece's id.
    """
    pieces: dict[str, list[Detection]] = {}
    for d in detections:
        if d.track_id:
            pieces.setdefault(d.track_id, []).append(d)
    for ds in pieces.values():
        ds.sort(key=lambda d: d.t_s)
    order = sorted(pieces, key=lambda k: pieces[k][0].t_s)
    joined: dict[str, str] = {}
    ends: dict[str, Detection] = {}  # merged id -> its latest detection
    times: dict[str, set[float]] = {}
    for tid in order:
        first = pieces[tid][0]
        best, best_d = None, None
        for root, last in ends.items():
            gap = first.t_s - last.t_s
            if gap <= 0 or gap > max_gap_s or any(round(d.t_s, 4) in times[root] for d in pieces[tid]):
                continue
            size = max(last.box[2] - last.box[0], last.box[3] - last.box[1], 1.0)
            cx = lambda b: ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)  # noqa: E731
            (ax, ay), (bx, by) = cx(last.box), cx(first.box)
            dist = float(np.hypot(ax - bx, ay - by)) / size
            if dist <= max_distance and (best_d is None or dist < best_d):
                best, best_d = root, dist
        if best is None:
            ends[tid], times[tid] = pieces[tid][-1], {round(d.t_s, 4) for d in pieces[tid]}
            continue
        joined[tid] = best
        for d in pieces[tid]:
            d.track_id = best
        ends[best] = pieces[tid][-1]
        times[best].update(round(d.t_s, 4) for d in pieces[tid])
    return joined
