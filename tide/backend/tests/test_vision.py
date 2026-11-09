"""The real pipeline wiring (tide + tide_api) with small TEST-ONLY models.

FakeDetector finds the coloured square in the synthetic video; FakeEncoder turns a picture into a
colour histogram. They exist only so the pipeline, tracking, species matching, reference pictures
and re-identification can be tested without the large model files. They are never used by the app.
"""
import importlib
import time
from dataclasses import replace

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from tide.clarity import clarity_index, summarise
from tide.config import ConfigError, load_vision_config
from tide.detect import Detection, box_iou, nms
from tide.species import NOVEL, UNKNOWN, ReferenceIndex, crop_box, match
from tide.track import VideoTracker, image_tracks
from conftest import confirm_and_count, use_short_protocol
from video_fixture import make_video


class FakeDetector:
    """TEST ONLY. Finds the orange-ish square drawn by video_fixture."""

    name = "test detector"

    def detect(self, image, frame_idx=0, t_s=0.0, enhance=False):
        mask = cv2.inRange(image, (20, 150, 190), (70, 210, 250))
        n, _, stats, _ = cv2.connectedComponentsWithStats(mask)
        return [Detection(frame_idx, t_s, (float(x), float(y), float(x + w), float(y + h)), "fish", 0.9, None)
                for x, y, w, h, area in stats[1:] if area > 50]


class FakeEncoder:
    """TEST ONLY. A normalised colour histogram stands in for a BioCLIP embedding."""

    name = "test encoder"

    def encode(self, crops):
        out = []
        for c in crops:
            h = cv2.calcHist([c], [0, 1, 2], None, [4, 4, 4], [0, 256] * 3).flatten().astype(np.float32)
            out.append(h / (np.linalg.norm(h) or 1))
        return np.stack(out) if out else np.zeros((0, 64), np.float32)


# ── unit tests ──

def test_vision_config_defaults():
    cfg = load_vision_config()
    assert cfg.detect.conf_threshold == 0.2
    assert cfg.species.novelty_threshold <= cfg.species.match_threshold
    assert cfg.detect.checkpoint.parent.name == "cfd" and cfg.species.model_dir.name == "bioclip-2"
    assert abs(sum(cfg.clarity.weights.values()) - 1.0) < 1e-6


def test_vision_config_rejects_nonsense(tmp_path):
    from tide.config import default_config_dir
    text = (default_config_dir() / "app.yaml").read_text(encoding="utf-8")
    bad = tmp_path / "app.yaml"
    bad.write_text(text.replace("novelty_threshold: 0.45", "novelty_threshold: 0.9"), encoding="utf-8")
    with pytest.raises(ConfigError, match="novelty_threshold"):
        load_vision_config(bad)
    bad.write_text(text.replace("    particles: 0.15\n", ""), encoding="utf-8")
    with pytest.raises(ConfigError, match="clarity.weights"):
        load_vision_config(bad)


def test_nms_keeps_best_of_overlapping_boxes():
    boxes = np.array([[0, 0, 10, 10], [1, 1, 11, 11], [50, 50, 60, 60]], np.float32)
    assert nms(boxes, np.array([0.5, 0.9, 0.4]), 0.5) == [1, 2]
    assert box_iou(boxes[0], boxes[2]) == 0


def _cfg():
    return load_vision_config().species


def test_species_match_rules():
    cfg = replace(_cfg(), best_match=False)  # only clear matches named
    a, b = np.eye(4, dtype=np.float32)[0], np.eye(4, dtype=np.float32)[1]
    index = ReferenceIndex.build([("cod", a), ("cunner", b)])
    sure = match(a[None], index, cfg)
    assert sure.label == "cod" and sure.top_k[0] == ("cod", 1.0) and sure.novelty == 0
    far = match(np.eye(4, dtype=np.float32)[2][None], index, cfg)
    assert far.label == NOVEL and far.reason
    between = (a + b) / np.linalg.norm(a + b)  # equally like both: never guessed
    assert match(between[None], index, cfg).label in (UNKNOWN, NOVEL)
    assert match(a[None], ReferenceIndex(), cfg).label == UNKNOWN  # no references yet
    alone = match(a[None], ReferenceIndex.build([("cod", a)]), cfg)  # one species: suggest, never fill in
    assert alone.label == UNKNOWN and alone.top_k[0][0] == "cod" and "Only one species" in alone.reason


def test_best_match_names_the_closest_species_and_says_why():
    cfg = _cfg()
    assert cfg.best_match  # app.yaml default: staff don't name thousands of fish by hand
    a, b = np.eye(4, dtype=np.float32)[0], np.eye(4, dtype=np.float32)[1]
    index = ReferenceIndex.build([("cod", a), ("cunner", b)])
    assert match(a[None], index, cfg).reason == ""  # a clear match needs no explanation
    near_a = np.array([0.6, 0.5, np.sqrt(1 - 0.61), 0], np.float32)  # closer to cod, but not clearly
    r = match(near_a[None], index, cfg)
    assert r.label == "cod" and "Closest match" in r.reason
    far = match(np.eye(4, dtype=np.float32)[2][None], index, cfg)
    assert far.label in ("cod", "cunner") and "not like any species" in far.reason
    assert match(a[None], ReferenceIndex(), cfg).label == UNKNOWN  # nothing to compare with
    assert match(np.zeros((0, 4), np.float32), index, cfg).label == UNKNOWN  # no crop


def test_crop_box_pads_and_rejects_tiny_boxes():
    img = np.zeros((100, 100, 3), np.uint8)
    assert crop_box(img, (40, 40, 60, 60), 0.5, 10).shape[:2] == (40, 40)
    assert crop_box(img, (40, 40, 45, 45), 0.1, 10) is None


def test_clarity_index_ranks_clear_above_murky():
    rng = np.random.default_rng(0)
    clear = rng.integers(0, 255, (240, 320, 3), dtype=np.uint8)
    clear = cv2.GaussianBlur(clear, (3, 3), 0)
    murky = cv2.addWeighted(cv2.GaussianBlur(clear, (31, 31), 0), 0.3, np.full_like(clear, (120, 140, 90)), 0.7, 0)
    cfg = load_vision_config().clarity
    assert 0 <= clarity_index(murky, cfg) < clarity_index(clear, cfg) <= 100
    assert type(clarity_index(clear, cfg)) is float  # numpy floats would be stored as bytes by SQLite
    s = summarise([30, 32, 31, 60, 62, 61])
    assert s.median == 46.0 and s.min == 30 and s.max == 62 and s.trend == "improving"
    assert summarise([]).median is None


def test_tracker_keeps_one_id_for_a_moving_fish():
    cfg = load_vision_config().track
    tr = VideoTracker("v", cfg, sample_fps=5)
    seen = []
    for k in range(10):
        x = 10 + 6 * k
        seen += tr.update([Detection(k, k / 5, (x, 40, x + 30, 70), "fish", 0.9, None)])
    assert len({d.track_id for d in seen}) == 1  # including the first sighting (backfilled)
    assert [d.track_id for d in image_tracks("img", [Detection(0, 0, (0, 0, 5, 5), "fish", 0.5, None) for _ in range(2)])] == \
        ["img-s1", "img-s2"]


# ── API with the test models ──

@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TIDE_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("TIDE_TOKEN", "")
    import tide_api.main as main
    from tide_api import pipeline
    importlib.reload(main)
    use_short_protocol(main)
    pipeline.set_vision(pipeline.Vision(load_vision_config(), detector=FakeDetector(), encoder=FakeEncoder()))
    return TestClient(main.app)


def _wait(client, job):
    for _ in range(3600):  # up to ~3 min: counting runs in the background
        job = client.get(f"/analyses/{job['jobId']}").json()
        if job["state"] != "running":
            return job
        time.sleep(0.05)
    raise AssertionError("analysis did not finish")


def _square_picture(path, colour=(40, 180, 220), border=20):
    """A square on a grey background. Reference pictures use a small border (like a fish photo)."""
    img = np.full((40 + 2 * border, 40 + 2 * border, 3), 90, np.uint8)
    cv2.rectangle(img, (border, border), (border + 40, border + 40), colour, -1)
    cv2.imwrite(str(path), img)
    return path


def test_real_pipeline_tracks_identifies_and_reidentifies(client, tmp_path, synthetic_video):
    status = client.get("/model").json()
    assert status["demo"] is False and status["device"] in ("gpu", "cpu")

    # A clip shorter than the protocol gets a shorter window to confirm (window.allow_short_videos).
    short = make_video(tmp_path / "T1_STAT1.mp4", seconds=6, fps=10)
    job = _wait(client, client.post("/analyses", json={"files": [str(short)], "ignoreSpecks": False}).json())
    assert job["state"] == "done" and "waiting for confirmation" in job["files"][0]["detail"]

    job = _wait(client, client.post("/analyses", json={"site": "Test", "files": [str(synthetic_video)],
                                                       "ignoreSpecks": False}).json())
    assert job["state"] == "done" and "waiting for confirmation" in job["files"][0]["detail"]
    assert confirm_and_count(client, job["surveyId"])["videos"][0]["countState"] == "done"
    data = client.get(f"/surveys/{job['surveyId']}").json()
    dets = [d for f in data["frames"] for d in f["detections"]]
    assert len(data["frames"]) >= 10 and dets
    point_tracks = {d["trackId"] for d in dets if "-p1-" in d["trackId"]}
    # One square → one track per pass; it wraps across the picture every ~3.7 s, so ≤ 4 in a ±5 s clip.
    assert 1 <= len(point_tracks) <= 4
    assert all(d["speciesId"] == "unknown" and d["aiLabel"] == "Unknown" for d in dets)  # no references yet
    assert all(f["clarity"] is not None for f in data["frames"])

    # A reference picture of the same colour makes the square identifiable…
    ref = _square_picture(tmp_path / "cod.png", border=5)
    refs = client.post("/species/cod/references", json={"paths": [str(ref)], "by": "Ana"}).json()
    other = _square_picture(tmp_path / "cunner.png", colour=(200, 60, 60), border=5)  # a second species to compare
    client.post("/species/cunner/references", json={"paths": [str(other)]})
    assert len(refs) == 1 and refs[0]["source"] == "cod.png" and refs[0]["addedBy"] == "Ana"
    assert client.get(refs[0]["image"]).status_code == 200
    assert next(s for s in client.get("/species").json() if s["id"] == "cod")["referenceCount"] == 1

    # …and re-identification applies it without detecting again.
    res = client.post(f"/surveys/{job['surveyId']}/reidentify").json()
    assert res["tracks"] >= 1 and res["changed"] == len(dets)
    dets = [d for f in client.get(f"/surveys/{job['surveyId']}").json()["frames"] for d in f["detections"]]
    assert all(d["speciesId"] == "cod" and d["suggestions"][0]["speciesId"] == "cod" for d in dets)

    # A box staff checked keeps its species when the AI changes its mind.
    first = dets[0]
    client.patch(f"/detections/{first['id']}", json={"speciesId": "cunner", "verified": True, "by": "Ana"})
    client.post(f"/surveys/{job['surveyId']}/reidentify")
    again = {d["id"]: d for f in client.get(f"/surveys/{job['surveyId']}").json()["frames"] for d in f["detections"]}
    assert again[first["id"]]["speciesId"] == "cunner" and again[first["id"]]["modelSpeciesId"] == "cod"

    # A checked fish can become a reference picture; removing it works.
    refs = client.post("/species/cunner/references/from-detection",
                       json={"detectionId": first["id"], "by": "Ana"}).json()
    assert len(refs) == 2
    assert client.delete(f"/references/{refs[-1]['id']}").status_code == 204
    assert len(client.get("/species/cunner/references").json()) == 1


def test_photos_are_identified_without_tracking(client, tmp_path):
    client.post("/species/cod/references", json={"paths": [str(_square_picture(tmp_path / "ref.png", border=5))]})
    client.post("/species/cunner/references",
                json={"paths": [str(_square_picture(tmp_path / "blue.png", colour=(200, 60, 60), border=5))]})
    photo = _square_picture(tmp_path / "photo.jpg")
    job = _wait(client, client.post("/analyses", json={"files": [str(photo)], "ignoreSpecks": False}).json())
    frame = client.get(f"/surveys/{job['surveyId']}").json()["frames"][0]
    assert frame["timestamp"] == "Photo" and frame["detections"][0]["speciesId"] == "cod"
    assert frame["detections"][0]["trackId"].endswith("-s1")


def test_reference_errors_are_plain_english(client, tmp_path):
    assert client.post("/species/nope/references", json={"paths": ["x.jpg"]}).status_code == 404
    r = client.post("/species/cod/references", json={"paths": [str(tmp_path / "missing.jpg")]})
    assert r.status_code == 400 and "Can't find" in r.json()["detail"]
    broken = tmp_path / "broken.jpg"
    broken.write_bytes(b"not a picture")
    r = client.post("/species/cod/references", json={"paths": [str(broken)]})
    assert r.status_code == 400 and "can't be opened" in r.json()["detail"]


def test_without_species_model_fish_stay_unknown(client, tmp_path):
    from tide_api import pipeline
    cfg = load_vision_config()
    cfg = replace(cfg, species=replace(cfg.species, model_dir=tmp_path / "none"))
    pipeline.set_vision(pipeline.Vision(cfg, detector=FakeDetector()))
    assert client.get("/model").json()["speciesModel"] == ""
    r = client.post("/species/cod/references", json={"paths": [str(_square_picture(tmp_path / "a.png"))]})
    assert r.status_code == 503 and "species model" in r.json()["detail"]
    job = _wait(client, client.post("/analyses", json={"files": [str(_square_picture(tmp_path / "p.png"))],
                                                       "ignoreSpecks": False}).json())
    det = client.get(f"/surveys/{job['surveyId']}").json()["frames"][0]["detections"][0]
    assert det["speciesId"] == "unknown" and "isn't installed" in det["unknownReason"]
