import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from video_fixture import make_video

SAMPLE = Path(__file__).resolve().parent.parent / "tide_api" / "sample" / "frame1.jpg"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TIDE_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("TIDE_TOKEN", "secret")
    import importlib

    import tide_api.main as main
    importlib.reload(main)
    return TestClient(main.app, headers={"X-TIDE-Token": "secret"})


def test_rejects_missing_token(client):
    assert client.get("/health", headers={"X-TIDE-Token": ""}).status_code == 401
    assert client.get("/health").json()["status"] == "ok"


def test_species_list_can_be_edited(client):
    names = [s["common"] for s in client.get("/species").json()]
    assert "Atlantic cod" in names
    added = next(s for s in client.post("/species", json={"common": "Black sea bass", "status": "unusual"}).json()
                 if s["common"] == "Black sea bass")
    assert added["custom"] is True and added["status"] == "unusual"
    after = client.patch(f"/species/{added['id']}", json={"status": "invasive"}).json()
    assert next(s for s in after if s["id"] == added["id"])["status"] == "invasive"
    assert all(s["id"] != added["id"] for s in client.delete(f"/species/{added['id']}").json())


def test_full_analysis_and_staff_check(client, tmp_path):
    video = make_video(tmp_path / "survey.mp4", seconds=20, fps=5)  # real file: the window check reads it
    job = client.post("/analyses", json={"site": "Mahone Bay", "files": [str(video), str(SAMPLE)]}).json()
    assert job["state"] == "running"
    for _ in range(100):
        job = client.get(f"/analyses/{job['jobId']}").json()
        if job["state"] != "running":
            break
        time.sleep(0.1)
    assert job["state"] == "done" and job["percent"] == 100

    data = client.get(f"/surveys/{job['surveyId']}").json()
    assert data["survey"]["site"] == "Mahone Bay"
    assert data["survey"]["frameCount"] == 4  # 3 sample pictures from the "video" + 1 photo
    first = data["frames"][0]
    assert client.get(first["image"]).headers["content-type"] == "image/jpeg"
    assert client.get(first["image"], headers={"X-TIDE-Token": ""}, params={"token": "secret"}).status_code == 200

    det = first["detections"][0]
    assert client.patch(f"/detections/{det['id']}", json={"speciesId": "not_fish", "verified": True}).status_code == 204
    again = client.get(f"/surveys/{job['surveyId']}").json()["frames"][0]["detections"][0]
    assert again["speciesId"] == "not_fish" and again["modelSpeciesId"] == det["modelSpeciesId"] and again["verified"]
    assert [s["id"] for s in client.get("/surveys").json()] == [job["surveyId"]]


def test_missing_file_is_a_clear_error(client):
    r = client.post("/analyses", json={"files": ["C:/nowhere/clip.mp4"]})
    assert r.status_code == 400 and "Can't find" in r.json()["detail"]


def wait(client, job):
    for _ in range(100):
        job = client.get(f"/analyses/{job['jobId']}").json()
        if job["state"] != "running":
            return job
        time.sleep(0.1)
    raise AssertionError("analysis didn't finish")


def test_people_and_who_checked(client, tmp_path):
    assert client.post("/people", json={"name": "Alex", "role": "analyst"}).json() == [{"name": "Alex", "role": "analyst"}]
    client.post("/people", json={"name": "alex", "role": "QC"})  # same name, any case: updated, not duplicated
    assert len(client.get("/people").json()) == 1
    job = wait(client, client.post("/analyses", json={"files": [str(SAMPLE)], "person": "Alex",
                                                       "surveyDate": "2025-08-20"}).json())
    data = client.get(f"/surveys/{job['surveyId']}").json()
    assert data["survey"]["createdBy"] == "Alex" and data["survey"]["surveyDate"] == "2025-08-20"
    det = data["frames"][0]["detections"][0]
    client.patch(f"/detections/{det['id']}", json={"speciesId": "cod", "verified": True, "by": "Alex"})
    det = client.get(f"/surveys/{job['surveyId']}").json()["frames"][0]["detections"][0]
    assert det["editedBy"] == "Alex"


def test_duplicate_species_blocked_and_invertebrates(client):
    r = client.post("/species", json={"common": "atlantic  COD"})
    assert r.status_code == 409 and "already" in r.json()["detail"]
    crab = next(s for s in client.get("/species").json() if s["id"] == "green_crab")
    assert crab["kind"] == "invertebrate" and crab["status"] == "invasive"
    added = client.post("/species", json={"common": "Rock crab", "kind": "invertebrate", "addedBy": "Jordan"}).json()
    rock = next(s for s in added if s["common"] == "Rock crab")
    assert rock["addedBy"] == "Jordan" and rock["addedAt"]


def test_bad_file_does_not_stop_the_batch(client, tmp_path):
    notes = tmp_path / "notes.docx"
    notes.write_bytes(b"x")
    broken = tmp_path / "broken.png"
    broken.write_bytes(b"x")
    import tide_api.pipeline as pipeline
    real = pipeline.extract_pictures

    def flaky(src, *a, **k):
        if src.name == "broken.png":
            raise ValueError("This picture is damaged")
        return real(src, *a, **k)

    pipeline.extract_pictures = flaky
    try:
        job = wait(client, client.post("/analyses", json={"files": [str(notes), str(broken), str(SAMPLE)]}).json())
    finally:
        pipeline.extract_pictures = real
    assert job["state"] == "done"
    states = {f["name"]: (f["state"], f["detail"]) for f in job["files"]}
    assert states["notes.docx"] == ("skipped", "Not a video or photo")
    assert states["broken.png"] == ("failed", "This picture is damaged")
    assert states["frame1.jpg"][0] == "done"


def test_blind_qc_sample_and_counts(client, tmp_path):
    video = make_video(tmp_path / "survey.mp4", seconds=20, fps=5)
    job = wait(client, client.post("/analyses", json={"files": [str(video)]}).json())
    sid = job["surveyId"]
    qc = client.get(f"/surveys/{sid}/qc", params={"percent": 50}).json()
    assert len(qc["sample"]) == 2 and qc["counts"] == []  # 50% of 3 pictures, rounded
    assert client.get(f"/surveys/{sid}/qc", params={"percent": 10}).json()["sample"] == qc["sample"]  # kept
    after = client.post(f"/surveys/{sid}/qc", json={"frameId": qc["sample"][0], "person": "Sam", "fish": 2}).json()
    assert after["counts"][0]["fish"] == 2 and after["counts"][0]["person"] == "Sam"
    bad = client.post(f"/surveys/{sid}/qc", json={"frameId": "999999", "person": "Sam", "fish": 1})
    assert bad.status_code == 400


def test_storage(client):
    s = client.get("/storage").json()
    assert s["freeBytes"] > 0 and s["databaseBytes"] > 0


def test_upgrades_an_old_database(tmp_path):
    import sqlite3

    from tide_api.db import Database
    old = tmp_path / "old.db"
    con = sqlite3.connect(old)
    con.executescript("""
      CREATE TABLE species (id TEXT PRIMARY KEY, common TEXT NOT NULL, scientific TEXT NOT NULL, status TEXT NOT NULL,
        habitat TEXT NOT NULL, custom INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL);
      INSERT INTO species VALUES ('cod', 'Atlantic cod', 'Gadus morhua', 'native', 'Marine', 0, 0);
      CREATE TABLE detections (id INTEGER PRIMARY KEY AUTOINCREMENT, frame_id INTEGER NOT NULL,
        species_id TEXT NOT NULL, model_species_id TEXT NOT NULL, confidence REAL NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0, x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL);
      CREATE TABLE surveys (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, environment TEXT NOT NULL,
        threshold REAL NOT NULL, files TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
    """)
    con.commit()
    con.close()
    db = Database(old)
    ids = [s.id for s in db.list_species()]
    assert "cod" in ids and "green_crab" in ids
    # "Type of water" was removed: the old NOT NULL column is dropped so new surveys can be saved.
    sid = db.create_survey("T1", 0.5, ["a.mp4"])
    assert db.one("SELECT site FROM surveys WHERE id = ?", sid)["site"] == "T1"


def test_fix_survey_date(client):
    job = wait(client, client.post("/analyses", json={"files": [str(SAMPLE)]}).json())
    sid = job["surveyId"]
    assert client.patch(f"/surveys/{sid}", json={"surveyDate": "20/08/2025"}).status_code == 422
    assert client.patch(f"/surveys/{sid}", json={"surveyDate": "2025-08-20", "site": "T1"}).status_code == 204
    info = client.get(f"/surveys/{sid}").json()["survey"]
    assert info["surveyDate"] == "2025-08-20" and info["site"] == "T1"
