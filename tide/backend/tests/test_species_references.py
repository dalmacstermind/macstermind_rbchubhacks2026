"""Species Registry: reference pictures with where they came from, thumbnails, and removing a picture.

Adding real reference pictures needs the species model, so these tests put pictures straight into
the database (with a dummy embedding) and test the API around them.
"""
import importlib

import numpy as np
import pytest
from fastapi.testclient import TestClient

from tide_api.db import ReferenceOrigin
from tide_api.schemas import Box

ALEX = {"X-TIDE-User": "Alex"}


@pytest.fixture()
def api(tmp_path, monkeypatch):
    monkeypatch.setenv("TIDE_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("TIDE_TOKEN", "secret")
    import tide_api.main as main
    importlib.reload(main)
    client = TestClient(main.app, headers={"X-TIDE-Token": "secret"})
    client.post("/people", json={"name": "Alex"})
    return client, main.db, tmp_path


def add_picture(db, tmp_path, species_id: str, name: str, origin: ReferenceOrigin | None = None) -> str:
    path = tmp_path / "references" / species_id / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"jpg")
    return str(db.add_reference(species_id, path, np.zeros(4, np.float32), "test", name, "Alex", origin))


def species(client, species_id: str) -> dict:
    return next(s for s in client.get("/species").json() if s["id"] == species_id)


def test_card_thumbnail_is_the_first_reference_picture(api):
    client, db, tmp_path = api
    assert species(client, "cunner")["thumbnail"] is None and species(client, "cunner")["referenceCount"] == 0
    first = add_picture(db, tmp_path, "cunner", "a.jpg")
    add_picture(db, tmp_path, "cunner", "b.jpg")
    sp = species(client, "cunner")
    assert sp["referenceCount"] == 2 and sp["thumbnail"] == f"/references/{first}/image"


def test_pictures_say_where_they_came_from(api):
    client, db, tmp_path = api
    sid = db.create_survey("Mahone Bay", 0.5, ["GX010021.MP4"])
    db.add_frame(sid, "GX010021.MP4", "00:06:00", str(tmp_path / "f.jpg"),
                 [("cunner", 0.9, Box(x=1, y=1, w=10, h=10), {"track_id": "t1"})])
    db.add_frame(sid, "photo.jpg", "Photo", str(tmp_path / "p.jpg"), [("cunner", 0.8, Box(x=1, y=1, w=10, h=10))])
    det_video, det_photo = (r["id"] for r in db.all("SELECT id FROM detections ORDER BY id"))
    assert db.detection_origin(det_video) == ReferenceOrigin(sid, "GX010021.MP4", "00:06:00")
    assert db.detection_origin(det_photo) == ReferenceOrigin(sid, "photo.jpg", "")  # photos have no time
    assert db.track_origin(sid, "t1") == ReferenceOrigin(sid, "GX010021.MP4", "00:06:00")
    assert db.detection_origin(999999) is None

    add_picture(db, tmp_path, "cunner", "crop.jpg", db.detection_origin(det_video))
    add_picture(db, tmp_path, "cunner", "uploaded.jpg")
    from_survey, uploaded = client.get("/species/cunner/references").json()
    assert (from_survey["surveyId"], from_survey["surveySite"]) == (sid, "Mahone Bay")
    assert (from_survey["sourceFile"], from_survey["sourceTime"]) == ("GX010021.MP4", "00:06:00")
    assert from_survey["addedBy"] == "Alex" and from_survey["addedAt"]
    assert (uploaded["surveyId"], uploaded["sourceFile"], uploaded["source"]) == (None, "", "uploaded.jpg")


def test_remove_a_picture(api):
    client, db, tmp_path = api
    first = add_picture(db, tmp_path, "cunner", "a.jpg")
    second = add_picture(db, tmp_path, "cunner", "b.jpg")
    r = client.delete(f"/species/cunner/references/{first}", headers=ALEX)
    assert r.status_code == 200 and [p["id"] for p in r.json()] == [second]
    assert not (tmp_path / "references" / "cunner" / "a.jpg").exists()
    assert species(client, "cunner")["thumbnail"] == f"/references/{second}/image"  # next picture
    removed = db.all("SELECT species_id, ref_id, source, removed_by FROM reference_removals")
    assert [tuple(r) for r in removed] == [("cunner", int(first), "a.jpg", "Alex")]


def test_remove_needs_someone_on_the_people_list(api):
    client, db, tmp_path = api
    ref = add_picture(db, tmp_path, "cunner", "a.jpg")
    for headers in ({}, {"X-TIDE-User": "Nobody"}):
        r = client.delete(f"/species/cunner/references/{ref}", headers=headers)
        assert r.status_code == 400 and "who's working" in r.json()["detail"]
    assert species(client, "cunner")["referenceCount"] == 1


def test_remove_only_this_species_pictures(api):
    client, db, tmp_path = api
    ref = add_picture(db, tmp_path, "cunner", "a.jpg")
    assert client.delete(f"/species/cod/references/{ref}", headers=ALEX).status_code == 404  # another species
    assert client.delete("/species/cunner/references/999999", headers=ALEX).status_code == 404
    assert client.delete(f"/species/no-such-species/references/{ref}", headers=ALEX).status_code == 404
    assert species(client, "cunner")["referenceCount"] == 1
