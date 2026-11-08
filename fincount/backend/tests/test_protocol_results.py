"""Counting at subsample points, MeanCount, richness, labels and evaluation (CLAUDE.md, Protocol rules).

Unit tests for the rules, then the whole flow through the API on the synthetic 3-minute video with a
short test protocol (window 10–70 s → points at 10, 30, 50 s) and the TEST-ONLY detector/encoder.
Counting only starts once a person confirms the proposed window (US-2.1).
"""
import csv
import importlib
import time

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from aquavision.config import load_protocol_config, load_vision_config
from aquavision.count import Sighting, TrackLabel, count_image, count_point, mean_count, species_richness
from aquavision.evaluate import HumanCount, compare, pct_diff, read_human_csv
from aquavision.ingest import recorded_date, transect_stat
from aquavision.labels import effective_labels
from conftest import confirm_and_count, use_short_protocol
from test_vision import FakeDetector, FakeEncoder

P = load_protocol_config()
CLARITY = load_vision_config().clarity
FISH = TrackLabel("fish", None, False)


# ── counting rules ──

def test_counted_only_within_the_tolerance_window_and_once_per_track():
    s = [Sighting("a", 59.0, 0.9), Sighting("a", 60.2, 0.9), Sighting("a", 60.4, 0.9),  # one fish, 3 pictures
         Sighting("b", 62.0, 0.9)]  # only seen 2 s after the point
    c = count_point("v", 1, 60.0, s, {}, 0.5, P, [], CLARITY)
    assert c.total_fish == 1 and c.unknown == 1 and c.outside == 1
    assert "outside ±0.5 s" in c.notes and not c.needs_review


def test_conservative_unsure_fish_need_review_and_are_not_counted():
    s = [Sighting("a", 60.0, 0.3)]
    c = count_point("v", 1, 60.0, s, {}, 0.5, P, [], CLARITY)
    assert c.total_fish == 0 and c.uncertain == 1 and c.needs_review
    confirmed = count_point("v", 1, 60.0, s, {"a": TrackLabel("fish", "cod", True)}, 0.5, P, [], CLARITY)
    assert confirmed.total_fish == 1 and confirmed.per_species == {"cod": 1} and confirmed.species_observed == 1


def test_labels_move_organisms_between_columns():
    s = [Sighting("a", 60, 0.9), Sighting("b", 60, 0.9), Sighting("c", 60, 0.9)]
    labels = {"a": TrackLabel("not_organism", None, True), "b": TrackLabel("invertebrate", None, True)}
    c = count_point("v", 1, 60.0, s, labels, 0.5, P, [], CLARITY)
    assert (c.total_fish, c.invertebrates, c.unknown) == (1, 1, 1)


def test_low_clarity_and_visibility_change_are_flagged():
    c = count_point("v", 2, 60.0, [], {}, 0.5, P, [10.0, 12.0, 14.0], CLARITY, previous_suggestion=">1.5 m")
    assert c.clarity_index == 12.0 and c.suggested_visibility == P.visibility_categories[0]
    assert "low visibility" in c.notes and "visibility changed" in c.notes and c.needs_review


def test_mean_count_keeps_zero_points_and_richness_counts_distinct_species():
    pts = [count_point("v", i, 60.0 * i, s, {}, 0.5, P, [], CLARITY)
           for i, s in enumerate([[Sighting("a", 60, 0.9), Sighting("b", 60, 0.9)], [], [Sighting("c", 180, 0.9)]], 1)]
    assert [p.total_fish for p in pts] == [2, 0, 1] and mean_count(pts) == 1.0
    labels = {"a": TrackLabel("fish", "cod", False), "b": TrackLabel("fish", "cod", False),
              "c": TrackLabel("fish", "cunner", True), "d": TrackLabel("fish", "flounder", False)}
    seen = [Sighting("a", 1, 0.9), Sighting("b", 1, 0.9), Sighting("c", 1, 0.1), Sighting("d", 1, 0.1)]
    assert species_richness(seen, labels, 0.5) == {"cod", "cunner"}  # flounder was never sure


def test_images_count_every_box():
    c = count_image("1", "a.jpg", [Sighting("x1", 0, 0.9), Sighting("x2", 0, 0.2)], {}, 0.5)
    assert c.total_fish == 1 and c.needs_review


def test_human_label_wins_over_ai_and_checks():
    det = [{"track_id": "t", "species_id": "cod", "model_species_id": "cod", "verified": 0}]
    assert effective_labels(det, [], {"cod": "fish"})["t"] == TrackLabel("fish", "cod", False)
    labelled = effective_labels(det, [{"track_id": "t", "action": "invertebrate", "species": None}], {"cod": "fish"})
    assert labelled["t"].kind == "invertebrate" and labelled["t"].human


def test_transect_stat_and_date_from_paths():
    assert transect_stat("Fall 2025/August 20_2025/T1/STAT 1/GX010021.MP4") == ("T1", "STAT 1")
    assert transect_stat("vlc-record-2026-11-06-17h37m49s-T1-STAT2 411.MP4-.mp4") == ("T1", "STAT 2")
    assert transect_stat("clip.mp4") == (None, None)
    assert str(recorded_date("Fall 2025/August 20_2025/T1/STAT 1/x.mp4")) == "2025-08-20"
    assert recorded_date("survey/clip.mp4") is None


# ── evaluation ──

def test_evaluation_metrics_follow_the_protocol():
    assert pct_diff(1, 2) == 50 and pct_diff(0, 0) == 0 and pct_diff(3, 0) == 300
    ai = {("GX01.MP4", 1): 2, ("GX01.MP4", 2): 0, ("GX01.MP4", 3): 5}
    human = [HumanCount("gx01", 1, 2), HumanCount("GX01", 2, 0), HumanCount("GX01", 3, 4), HumanCount("GX01", 9, 1)]
    ev = compare(ai, human, P.qc, "test")
    assert ev.points_compared == 3 and ev.share_within == pytest.approx(2 / 3, abs=1e-3)
    assert ev.zero_agreement == 1.0 and ev.meets_agreement is False and ev.unmatched_human == ["GX01 point 9"]
    v = ev.videos[0]
    assert (v.mean_count_ai, v.mean_count_human) == (pytest.approx(7 / 3, abs=1e-3), pytest.approx(2.0))


def test_hand_count_csv(tmp_path):
    good = tmp_path / "h.csv"
    good.write_text("Video,Point,Total_Fish,Invertebrates\nGX01.MP4,1,3,\nGX01.MP4,2,0,1\n", encoding="utf-8")
    assert [h.total_fish for h in read_human_csv(good)] == [3, 0]
    bad = tmp_path / "b.csv"
    bad.write_text("video,count\nx,1\n", encoding="utf-8")
    with pytest.raises(ValueError, match="needs the columns"):
        read_human_csv(bad)


# ── the whole flow through the API ──

@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("FINCOUNT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("FINCOUNT_TOKEN", "")
    import fincount_api.main as main
    from fincount_api import pipeline
    importlib.reload(main)
    use_short_protocol(main)
    pipeline.set_vision(pipeline.Vision(load_vision_config(), detector=FakeDetector(), encoder=FakeEncoder()))
    return TestClient(main.app)


def _analyse(client, files):
    job = client.post("/analyses", json={"site": "T", "files": files, "ignoreSpecks": False}).json()
    for _ in range(3600):  # up to ~3 min: counting runs in the background
        job = client.get(f"/analyses/{job['jobId']}").json()
        if job["state"] != "running":
            break
        time.sleep(0.05)
    assert job["state"] == "done", job
    return job["surveyId"]


def test_points_meancount_labels_and_evaluation(client, synthetic_video, tmp_path):
    sid = _analyse(client, [str(synthetic_video)])
    # Nothing is counted until a person confirms the proposed window.
    v = client.get(f"/surveys/{sid}/results").json()["videos"][0]
    assert v["windowStartS"] is None and v["points"] == [] and v["countState"] == "" and v["proposedStartS"] == 10
    res = confirm_and_count(client, sid)
    v = res["videos"][0]
    assert (v["windowStartS"], v["windowEndS"], v["confirmedBy"], v["countState"]) == (10, 70, "Ana", "done")
    assert [(p["pointNo"], p["timestampS"]) for p in v["points"]] == [(1, 10), (2, 30), (3, 50)]
    p = v["points"][0]
    assert p["totalFish"] == 1 and p["unknown"] == 1 and p["ai"]["totalFish"] == 1 and v["meanCount"] == 1
    assert p["clip"] and client.get(p["clip"]).status_code == 200
    assert v["speciesRichness"] == 0 and res["unknownsRemaining"] >= 1

    # The Label page: one card per tracked fish.
    unk = client.get(f"/surveys/{sid}/unknowns").json()
    card = next(f for f in unk["fish"] if f["source"]["role"] == "point")
    assert card["source"]["pointNo"] == 1 and client.get(card["crop"]).status_code == 200
    point_tracks = [f["trackId"] for f in unk["fish"] if f["source"]["role"] == "point"]

    # Label it Atlantic cod → per-species count and richness update; undo puts it back.
    r = client.post("/labels", json={"surveyId": sid, "trackIds": point_tracks, "action": "species",
                                     "species": "cod", "by": "Ana"}).json()
    v = client.get(f"/surveys/{sid}/results").json()["videos"][0]
    assert v["points"][0]["perSpecies"] == {"cod": 1} and v["points"][0]["unknown"] == 0
    assert "cod" in v["speciesFound"]
    for lid in r["labelIds"]:
        assert client.delete(f"/labels/{lid}").status_code == 200
    assert client.get(f"/surveys/{sid}/results").json()["videos"][0]["points"][0]["unknown"] == 1

    # "Not a fish" removes it from the count.
    client.post("/labels", json={"surveyId": sid, "trackIds": point_tracks, "action": "not_organism", "by": "Ana"})
    assert client.get(f"/surveys/{sid}/results").json()["videos"][0]["points"][0]["totalFish"] == 0
    for f in client.get(f"/surveys/{sid}/unknowns").json()["fish"]:
        if f["label"]:
            client.delete(f"/labels/{f['label']['id']}")

    # Drawing a box the AI missed, on the picture at the point, adds one organism…
    frames = client.get(f"/surveys/{sid}").json()["frames"]
    at_point = next(f for f in frames if f["timestamp"] == "00:00:10")
    r = client.post("/labels", json={"surveyId": sid, "action": "invertebrate", "invertebrateType": "crab",
                                     "frameId": at_point["id"], "box": {"x": 2, "y": 80, "w": 10, "h": 10},
                                     "by": "Ana"})
    assert r.status_code == 200, r.text
    p = client.get(f"/surveys/{sid}/results").json()["videos"][0]["points"][0]
    assert (p["totalFish"], p["invertebrates"]) == (1, 1)
    # …but drawing over an existing fish relabels it instead of counting it twice.
    fish_box = next(d for d in at_point["detections"] if d["trackId"])["box"]
    client.post("/labels", json={"surveyId": sid, "action": "species", "species": "cunner", "frameId": at_point["id"],
                                 "box": fish_box, "by": "Ana"})
    p = client.get(f"/surveys/{sid}/results").json()["videos"][0]["points"][0]
    assert (p["totalFish"], p["perSpecies"]) == (1, {"cunner": 1})

    # Staff review of a point is kept next to the AI's value…
    assert client.patch(f"/points/{p['id']}", json={"totalFish": 2, "visibility": "1.0–1.5 m", "by": "Ana"}) \
        .status_code == 204
    v = client.get(f"/surveys/{sid}/results").json()["videos"][0]
    assert (v["points"][0]["totalFish"], v["points"][0]["ai"]["totalFish"], v["meanCount"], v["meanCountAi"]) == \
        (2, 1, pytest.approx(4 / 3, abs=1e-3), 1)  # 3 points: (2 + 1 + 1) / 3
    assert v["points"][0]["reviewed"] and v["points"][0]["visibility"] == "1.0–1.5 m"

    # …and the AI can be measured against it, or against a CSV of hand counts.
    ev = client.post(f"/surveys/{sid}/evaluation", json={}).json()
    assert ev["pointsCompared"] == 1 and ev["points"][0]["absDiff"] == 1 and ev["points"][0]["pctDiff"] == 50
    hand = tmp_path / "hand.csv"
    with open(hand, "w", newline="", encoding="utf-8") as fh:
        csv.writer(fh).writerows([["video", "point", "total_fish"], [synthetic_video.name, 1, 1]])
    ev = client.post(f"/surveys/{sid}/evaluation", json={"path": str(hand)}).json()
    assert ev["shareWithin"] == 1.0 and ev["source"] == "hand.csv"

    # Recording details.
    assert client.patch(f"/videos/{v['id']}/details", json={"recordedAt": "2025-08-20", "transect": "T1",
                                                            "stat": "STAT 1"}).status_code == 204
    v = client.get(f"/surveys/{sid}/results").json()["videos"][0]
    assert (v["recordedAt"], v["transect"], v["stat"]) == ("2025-08-20", "T1", "STAT 1")

    # Confirming a different window counts again from scratch (labels on the old count go away).
    v = confirm_and_count(client, sid, start_s=20)["videos"][0]
    assert v["windowStartS"] == 20 and [p["timestampS"] for p in v["points"]] == [20, 40, 60]
    assert v["points"][0]["perSpecies"] == {} and v["points"][0]["reviewed"] is False


def test_label_errors_are_plain_english(client, synthetic_video):
    sid = _analyse(client, [str(synthetic_video)])
    confirm_and_count(client, sid)
    r = client.post("/labels", json={"surveyId": sid, "trackIds": ["x"], "action": "species", "species": "Cuner",
                                     "by": "Ana"})
    assert r.status_code == 400 and "species list" in r.json()["detail"]
    assert client.delete("/labels/999").status_code == 404
    img = np.full((100, 100, 3), 90, np.uint8)
    assert cv2.imwrite(str(synthetic_video.parent / "photo.png"), img)
    sid2 = _analyse(client, [str(synthetic_video.parent / "photo.png")])
    res = client.get(f"/surveys/{sid2}/results").json()
    assert res["videos"] == [] and res["images"][0]["relPath"] == "photo.png"


def test_evaluate_command_line(tmp_path, capsys):
    import json

    from aquavision.evaluate import main
    results = {"videos": [{"name": "GX01.MP4", "points": [{"pointNo": 1, "ai": {"totalFish": 2}},
                                                          {"pointNo": 2, "ai": {"totalFish": 0}}]}]}
    (tmp_path / "r.json").write_text(json.dumps(results), encoding="utf-8")
    (tmp_path / "h.csv").write_text("video,point,total_fish\nGX01,1,2\nGX01,2,1\n", encoding="utf-8")
    assert main(["--results", str(tmp_path / "r.json"), "--human", str(tmp_path / "h.csv")]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["points_compared"] == 2 and out["share_within"] == 0.5 and out["zero_agreement"] == 0.5
