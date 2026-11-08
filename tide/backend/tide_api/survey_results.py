"""Builds API responses for protocol results, the label gallery and evaluation.

Thin glue between the database rows and `tide` (count.py, results.py, labels.py,
evaluate.py), which hold the protocol logic.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict
from pathlib import Path

import numpy as np

from tide import results as av_results
from tide.config import load_vision_config
from tide.detect import box_iou
from tide.evaluate import HumanCount, compare, read_human_csv
from tide.labels import UNKNOWN_ID, check_label, effective_labels, mirror_species_id
from tide.species import NOVEL, UNKNOWN

from .db import Database
from .settings import survey_protocol
from .schemas import (AiPointCount, Box, EvaluationOut, ImageOut, LabelOut, PointOut, Suggestion, SurveyResults,
                      UnknownFish, Unknowns, UnknownSource, VideoOut)


def _registry(db: Database) -> dict[str, str]:
    return {s.id: s.kind for s in db.list_species()}


def _labels(db: Database, survey_id: int, registry: dict[str, str]):
    return effective_labels(db.survey_detections(survey_id), db.active_labels(survey_id), registry)


def build_results(db: Database, survey_id: int, threshold: float) -> SurveyResults:
    protocol = survey_protocol(db, survey_id)  # the values this survey was processed with, not today's settings
    clarity_cfg = load_vision_config().clarity
    registry = _registry(db)
    labels = _labels(db, survey_id, registry)
    remaining = unknowns(db, survey_id).remaining_by_file
    videos = []
    for v in db.video_rows(survey_id):
        points = db.points(v["id"])
        frames = {p["point_no"]: db.point_frames(v["id"], p["point_no"]) for p in points}
        s = av_results.video_summary(v, points, db.video_sightings(v["id"]), frames, labels, threshold, protocol,
                                     clarity_cfg)
        videos.append(VideoOut(
            id=s.id, name=s.name, recorded_at=s.recorded_at, transect=s.transect, stat=s.stat,
            window_start_s=s.window_start_s, window_end_s=s.window_end_s, proposed_start_s=s.proposed_start_s,
            proposed_end_s=s.proposed_end_s, proposed_reason=s.proposed_reason, settled=s.settled,
            too_short=s.too_short, confirmed_by=s.confirmed_by, count_state=s.count_state,
            count_detail=s.count_detail, mean_count=s.mean_count, mean_count_ai=s.mean_count_ai,
            species_richness=s.species_richness, species_found=s.species_found, clarity_index=s.clarity_index,
            clarity_min=s.clarity_min, clarity_max=s.clarity_max, clarity_trend=s.clarity_trend,
            visibility=s.visibility, reviewed=s.reviewed, unknowns_remaining=remaining.get(s.name, 0),
            points=[PointOut(
                id=p.id, point_no=p.ai.point_no, timestamp_s=p.ai.timestamp_s, total_fish=p.total_fish,
                invertebrates=p.invertebrates, per_species=p.ai.per_species, unknown=p.ai.unknown,
                species_observed=p.ai.species_observed, clarity_index=p.ai.clarity_index,
                suggested_visibility=p.ai.suggested_visibility, visibility=p.visibility, notes=p.ai.notes,
                staff_notes=p.staff_notes, needs_review=p.ai.needs_review, reviewed=p.reviewed,
                edited_by=p.edited_by, uncertain=p.ai.uncertain, outside=p.ai.outside,
                ai=AiPointCount(total_fish=p.ai.total_fish, invertebrates=p.ai.invertebrates),
                clip=f"/points/{p.id}/clip" if p.has_clip else None) for p in s.points]))
    images = [ImageOut(**asdict(c)) for c in av_results.image_counts(db.photo_sightings(survey_id), labels, threshold)]
    return SurveyResults(videos=videos, images=images, unknowns_remaining=sum(remaining.values()),
                         visibility_categories=list(protocol.visibility_categories))


# ── Label gallery ──

def unknowns(db: Database, survey_id: int) -> Unknowns:
    """One card per tracked organism the AI couldn't name (or a person drew), labelled or not.

    Richness-scan organisms the detector was never sure about are left out: they can't change any
    count or the species richness, and would bury the fish that matter.
    """
    import json
    rows = db.survey_detections(survey_id)
    active = {lab["track_id"]: lab for lab in db.active_labels(survey_id)}
    by_track: dict[str, list] = defaultdict(list)
    for r in rows:
        if r["track_id"] and (r["ai_label"] in (UNKNOWN, NOVEL) or r["box_source"] == "human_drawn"
                              or r["model_species_id"] == UNKNOWN_ID and r["ai_label"] == ""):
            by_track[r["track_id"]].append(r)
    found = db.get_survey(survey_id)
    threshold = found[0].threshold if found else 0.5
    fish, remaining = [], defaultdict(int)
    for tid, dets in by_track.items():
        if all(d["role"] == "scan" for d in dets) and max(d["confidence"] for d in dets) < threshold                 and not any(d["verified"] for d in dets) and tid not in active:
            continue
        dets.sort(key=lambda d: (d["t_s"] or 0, d["id"]))
        best = max(dets, key=lambda d: d["confidence"])
        lab = active.get(tid)
        checked = any(d["verified"] for d in dets)
        if not lab and not checked:
            remaining[best["source"]] += 1
        fish.append(UnknownFish(
            track_id=tid, crop=f"/surveys/{survey_id}/tracks/{tid}/crop",
            source=UnknownSource(kind="image" if best["role"] == "photo" else "video", file=best["source"],
                                 video_id=best["video_id"], point_no=best["point_no"], timestamp=best["timestamp"],
                                 role=best["role"]),
            frame_ids=[str(d["fid"]) for d in dets], best_frame_id=str(best["fid"]),
            box=Box(x=best["x"], y=best["y"], w=best["w"], h=best["h"]), ai_label=best["ai_label"] or UNKNOWN,
            suggestions=[Suggestion(species_id=k, score=v) for k, v in json.loads(best["top_k"] or "[]")],
            reason=best["unknown_reason"] or ("Drawn by a person" if best["box_source"] == "human_drawn" else ""),
            label=LabelOut(id=str(lab["id"]), action=lab["action"], species=lab["species"],
                           invertebrate_type=lab["invertebrate_type"], labelled_by=lab["labelled_by"],
                           labelled_at=lab["labelled_at"]) if lab else None))
    # Unlabelled first; fish at subsample points first (they change MeanCount), then photos, then the scan.
    order = {"point": 0, "photo": 1, "scan": 2}
    fish.sort(key=lambda f: (f.label is not None, order.get(f.source.role, 3), f.source.file, f.source.point_no or 0,
                             f.source.timestamp))
    return Unknowns(fish=fish, remaining=sum(remaining.values()), remaining_by_file=dict(remaining))


def apply_label(db: Database, survey_id: int, track_ids: list[str], action: str, species: str | None,
                invertebrate_type: str | None, use_as_reference: bool, by: str, frame_id: int | None = None,
                box: Box | None = None, add_reference=None) -> list[int]:
    """Label one or more organisms. A drawn box that overlaps an existing organism relabels it instead."""
    registry = _registry(db)
    check_label(action, species, invertebrate_type, registry)
    source = "ai"
    if box is not None:
        frame = db.frame_row(frame_id) if frame_id is not None else None
        if not frame or frame["survey_id"] != survey_id:
            raise LookupError("That picture isn't in this survey.")
        match_iou = load_vision_config().label.match_iou
        drawn = (box.x, box.y, box.x + box.w, box.y + box.h)
        overlap = [(box_iou(drawn, (d["x"], d["y"], d["x"] + d["w"], d["y"] + d["h"])), d)
                   for d in db.frame_detections(frame_id) if d["track_id"]]
        best = max(overlap, key=lambda o: o[0], default=(0.0, None))
        if best[1] is not None and best[0] >= match_iou:
            track_ids = [best[1]["track_id"]]  # relabel the existing organism: never count it twice
        else:
            track_ids = [db.add_drawn_box(frame_id, box.x, box.y, box.w, box.h, by)]
            source = "human_drawn"
    if not track_ids:
        raise ValueError("Choose at least one fish to label.")
    ids = []
    for tid in track_ids:
        ids.append(db.add_label(survey_id, tid, action, species if action == "species" else None,
                                invertebrate_type if action == "invertebrate" else None, source, frame_id,
                                use_as_reference, by, mirror_species_id(action, species)))
        if use_as_reference and action == "species" and add_reference is not None:
            crop = db.track_crop(survey_id, tid)
            if crop and Path(crop).is_file():
                add_reference(species, Path(crop), by)
    return ids


# ── Evaluation ──

def evaluate(db: Database, survey_id: int, threshold: float, csv_path: str | None) -> EvaluationOut:
    """AI point counts vs hand counts: from a CSV, or from the points staff corrected in the app."""
    res = build_results(db, survey_id, threshold)
    ai = {(v.name, p.point_no): p.ai.total_fish for v in res.videos for p in v.points}
    if csv_path:
        human = read_human_csv(Path(csv_path))
        source = Path(csv_path).name
    else:
        # A point a person reviewed carries their count (their correction, or a confirmation of the AI's).
        human = [HumanCount(v.name, p.point_no, p.total_fish) for v in res.videos for p in v.points if p.reviewed]
        source = "points reviewed by staff in the app"
    ev = compare(ai, human, survey_protocol(db, survey_id).qc, source)
    return EvaluationOut(**asdict(ev))


def crop_image(db: Database, survey_id: int, track_id: str) -> Path | bytes | None:
    """The saved best crop of an organism, or one cut from its best picture (e.g. a drawn box)."""
    import cv2

    from tide.analyse import read_image
    from tide.species import crop_box
    path = db.track_crop(survey_id, track_id)
    if path and Path(path).is_file():
        return Path(path)
    rows = [r for r in db.survey_detections(survey_id) if r["track_id"] == track_id]
    if not rows:
        return None
    best = max(rows, key=lambda r: r["confidence"])
    saved = db.frame_image(best["frame_id"])
    if not saved or not saved.is_file():
        return None
    img = read_image(saved)
    h, w = img.shape[:2]
    crop = crop_box(img, (best["x"] * w / 100, best["y"] * h / 100, (best["x"] + best["w"]) * w / 100,
                          (best["y"] + best["h"]) * h / 100), 0.12, 2)
    if crop is None:
        return None
    ok, buf = cv2.imencode(".jpg", crop)
    return np.asarray(buf).tobytes() if ok else None
