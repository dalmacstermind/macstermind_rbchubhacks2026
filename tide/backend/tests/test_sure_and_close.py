"""Less for people to check, and more real fish found.

- A fish the species model is sure of counts without anyone checking it; the rest are Unknown.
- A check in "Check the fish" applies to every picture of that fish (its track).
- The counted pictures also get the close search (full-resolution tiles), merged so one fish keeps one box.
"""
from __future__ import annotations

import numpy as np

from tide.analyse import Analyser
from tide.config import load_protocol_config, load_vision_config
from tide.count import Sighting, TrackLabel, count_point
from tide.detect import Detection, box_contain, clear_murky, nms, tile_windows
from tide.labels import effective_labels
from tide_api.db import Database
from tide_api.schemas import Box


# ── the species model's certainty ──

def _row(tid, model, reason, verified=0, species=None):
    return {"track_id": tid, "model_species_id": model, "species_id": species or model, "verified": verified,
            "unknown_reason": reason}


def test_a_clear_species_match_is_sure_and_a_guess_is_not():
    registry = {"cod": "fish", "unknown": "fish"}
    labels = effective_labels([_row("a", "cod", ""), _row("b", "unknown", "Two or more species look equally likely."),
                               _row("c", "cod", "Closest match (similarity 0.60, not a clear match).")], [], registry)
    assert labels["a"] == TrackLabel("fish", "cod", False, True)
    assert not labels["b"].sure and labels["b"].species is None
    assert not labels["c"].sure


def test_a_sure_fish_counts_however_faint_its_box():
    prot, vis = load_protocol_config(), load_vision_config()
    seen = [Sighting("sure", 10.0, 0.2), Sighting("unsure", 10.0, 0.2)]
    labels = {"sure": TrackLabel("fish", "cod", False, True), "unsure": TrackLabel("fish", None, False)}
    c = count_point("1", 1, 10.0, seen, labels, 0.4, prot, [], vis.clarity)
    assert c.total_fish == 1 and c.per_species == {"cod": 1} and c.uncertain == 1


# ── one fish, checked once ──

def test_checking_one_picture_checks_the_whole_fish(tmp_path):
    db = Database(tmp_path / "t.db")
    sid = db.create_survey("T1", 0.4, ["a.mp4"])
    box = Box(x=10, y=10, w=5, h=5)
    extra = {"track_id": "v-p1-t1", "ai_label": "Unknown"}
    f1 = db.add_frame(sid, "a.mp4", "00:00:01", "a.jpg", [("unknown", 0.2, box, extra), ("unknown", 0.3, box,
                                                          {"track_id": "v-p1-t2"})])
    f2 = db.add_frame(sid, "a.mp4", "00:00:02", "b.jpg", [("unknown", 0.25, box, extra)])
    first = db.frame_detections(f1)[0]["id"]
    changed = db.update_detection(first, "cod", True, "Ana")
    assert len(changed) == 2  # both pictures of fish t1, not fish t2
    rows = {r["track_id"]: r for f in (f1, f2) for r in db.frame_detections(f)}
    assert all(r["species_id"] == "cod" and r["verified"] for r in db.frame_detections(f2))
    assert rows["v-p1-t2"]["species_id"] == "unknown" and not rows["v-p1-t2"]["verified"]
    assert db.update_detection(999999, "cod", True, "Ana") == []


# ── finding more fish ──

def test_tiles_cover_the_picture_and_nested_boxes_merge():
    wins = tile_windows(3840, 2160, 1024, 0.2)
    assert len(wins) == 15
    covered = np.zeros((2160, 3840), bool)
    for x, y in wins:
        covered[y:y + 1024, x:x + 1024] = True
    assert covered.all()
    assert tile_windows(800, 600, 1024, 0.2) == [(0, 0)]
    big, part = (100, 100, 200, 140), (110, 105, 150, 135)  # a fish and a box on part of it
    assert box_contain(big, part) == 1.0
    b, s = np.array([big, part], np.float32), np.array([0.6, 0.3], np.float32)
    assert nms(b, s, 0.5) == [0, 1]  # plain overlap misses it
    assert nms(b, s, 0.5, contain=0.85) == [0]


def test_clear_murky_keeps_the_picture_size():
    img = np.full((60, 80, 3), (90, 140, 110), np.uint8)
    out = clear_murky(img)
    assert out.shape == img.shape and out.dtype == np.uint8


class _Detector:
    """TEST ONLY: one box from the whole picture; the close search finds that fish in part and a small one."""

    def __init__(self):
        self.close_calls = 0

    def detect(self, image, frame_idx=0, t_s=0.0, enhance=False):
        return [Detection(frame_idx, t_s, (100, 100, 200, 140), "fish", 0.6, None)]

    def detect_close(self, raw, scale, frame_idx=0, t_s=0.0, enhance=False):
        self.close_calls += 1
        return [Detection(frame_idx, t_s, (110, 105, 150, 135), "fish", 0.3, None),
                Detection(frame_idx, t_s, (400, 50, 420, 60), "fish", 0.25, None)]


def test_close_search_only_where_asked_and_one_fish_keeps_one_box():
    det = _Detector()
    an = Analyser(load_vision_config(), det)
    img = np.zeros((540, 960, 3), np.uint8)
    assert len(an._detect(img, img, 0, 0.0, False)) == 1 and det.close_calls == 0
    found = an._detect(img, img, 0, 0.0, False, close=True)
    assert det.close_calls == 1
    assert sorted(d.box for d in found) == [(100, 100, 200, 140), (400, 50, 420, 60)]  # the part merged away


def test_label_page_only_lists_fish_that_can_change_a_count(tmp_path):
    from tide.protocol import WindowProposal
    from tide_api import survey_results
    db = Database(tmp_path / "t.db")
    sid = db.create_survey("T1", 0.4, ["a.mp4"])
    vid = db.add_video(sid, "a.mp4", "a.mp4", 600, 30, WindowProposal(0, 600, "", True, False, None))
    db.add_point(vid, 1, 60.0, "")
    box = Box(x=10, y=10, w=5, h=5)
    unknown = {"ai_label": "Unknown", "unknown_reason": "Not similar enough"}
    for t, tid in ((60.2, "near"), (63.0, "outside")):
        db.add_frame(sid, "a.mp4", "00:01:00", "a.jpg", [("unknown", 0.2, box, {**unknown, "track_id": tid})],
                     video_id=vid, point_no=1, t_s=t, role="point")
    cards = [f.track_id for f in survey_results.unknowns(db, sid).fish]
    assert cards == ["near"]  # "outside" is only seen 3 s from the point: it can never be counted
