"""Default reference pictures: picking iNaturalist photos (no internet needed here) and adding them to
the Species Registry once, with their credits."""
import importlib
from dataclasses import replace

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from tide import fetch_reference_images as seed
from tide.config import load_vision_config
from tide_api import pipeline


def obs(obs_id, photo_id, licence="cc-by", grade="research"):
    return {"id": obs_id, "quality_grade": grade, "photos": [{
        "id": photo_id, "license_code": licence, "attribution": f"(c) Photographer {photo_id}, some rights reserved (CC BY)",
        "url": f"https://inaturalist-open-data.s3.amazonaws.com/photos/{photo_id}/square.jpg"}]}


def test_picks_only_research_grade_cc0_and_cc_by_one_per_observation():
    observations = [obs(1, 11), obs(2, 22, licence="cc-by-nc"), obs(3, 33, grade="needs_id"),
                    obs(4, 44, licence="cc0"), obs(5, 55)]
    picked = seed.pick_photos(observations, wanted=10)
    assert [p["photo_id"] for p in picked] == [11, 44, 55]
    first = picked[0]
    assert first["url"].endswith("/photos/11/medium.jpg")  # 500 px, not the 75 px thumbnail
    assert first["observation"] == "https://www.inaturalist.org/observations/1"
    assert first["licence"] == "cc-by" and "Photographer 11" in first["credit"] and first["file"] == "inat-11.jpg"


def test_stops_at_the_number_wanted():
    assert len(seed.pick_photos([obs(i, i) for i in range(1, 50)], wanted=25)) == 25


def test_download_refuses_a_file_with_the_wrong_checksum(tmp_path, monkeypatch):
    manifest = {"cunner": [{"photo_id": 1, "file": "inat-1.jpg", "url": "x", "sha256": "0" * 64, "credit": ""}]}
    monkeypatch.setattr(seed, "load_manifest", lambda: manifest)
    cfg = load_vision_config()
    monkeypatch.setattr(seed, "load_vision_config", lambda: replace(cfg, species=replace(cfg.species, seed_dir=tmp_path)))
    monkeypatch.setattr(seed, "_get", lambda url: b"not the expected bytes")
    assert seed.fetch() == 1
    assert not (tmp_path / "cunner" / "inat-1.jpg").exists()


class FakeEncoder:
    name = "test-encoder"

    def encode(self, crops):
        return np.ones((len(crops), 8), np.float32)


@pytest.fixture()
def api(tmp_path, monkeypatch):
    """The API with a stand-in species model and three downloaded default pictures (two cunner, one cod)."""
    monkeypatch.setenv("TIDE_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("TIDE_TOKEN", "secret")
    cfg = load_vision_config()
    seed_dir = tmp_path / "seed"
    cfg = replace(cfg, species=replace(cfg.species, seed_dir=seed_dir))
    pipeline.set_vision(pipeline.Vision(cfg, encoder=FakeEncoder()))
    manifest = {"cunner": [], "cod": [], "not_in_registry": []}
    for sid, pid in (("cunner", 1), ("cunner", 2), ("cod", 3), ("not_in_registry", 4)):
        f = seed_dir / sid / f"inat-{pid}.jpg"
        f.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(f), np.full((40, 60, 3), 100, np.uint8))
        manifest[sid].append({"photo_id": pid, "file": f.name, "credit": f"(c) Photographer {pid} (CC BY)"})
    manifest["cod"].append({"photo_id": 9, "file": "inat-9.jpg", "credit": ""})  # listed, not downloaded
    import tide_api.main as main
    importlib.reload(main)
    client = TestClient(main.app, headers={"X-TIDE-Token": "secret"})
    client.post("/people", json={"name": "Alex"})
    return client, main.db, manifest


def count(client, sid):
    return next(s for s in client.get("/species").json() if s["id"] == sid)["referenceCount"]


def test_default_pictures_are_added_with_their_credit(api, tmp_path):
    client, db, manifest = api
    assert pipeline.seed_default_references(db, tmp_path / "data", manifest) == 3
    assert (count(client, "cunner"), count(client, "cod")) == (2, 1)
    refs = client.get("/species/cunner/references").json()
    assert refs[0]["source"] == "iNaturalist photo 1 · (c) Photographer 1 (CC BY)"
    assert refs[0]["addedBy"] == "TIDE default pictures"
    assert next(s for s in client.get("/species").json() if s["id"] == "cunner")["thumbnail"]


def test_added_once_and_removed_pictures_stay_removed(api, tmp_path):
    client, db, manifest = api
    pipeline.seed_default_references(db, tmp_path / "data", manifest)
    assert pipeline.seed_default_references(db, tmp_path / "data", manifest) == 0  # nothing new
    first = client.get("/species/cunner/references").json()[0]["id"]
    client.delete(f"/species/cunner/references/{first}", headers={"X-TIDE-User": "Alex"})
    pipeline.seed_default_references(db, tmp_path / "data", manifest)
    assert count(client, "cunner") == 1  # the removed picture is not added back


def test_nothing_happens_without_the_species_model(api, tmp_path):
    client, db, manifest = api
    pipeline.set_vision(pipeline.Vision(replace(load_vision_config(), species=replace(
        load_vision_config().species, model_dir=tmp_path / "none"))))
    assert pipeline.seed_default_references(db, tmp_path / "data", manifest) == 0
    assert count(client, "cunner") == 0


# ── Pictures shipped with their fingerprints: shown on first start, even without the species model ──

def write_prints(seed_dir, ids, model="BioCLIP 2", revision=None):
    from tide.fetch_models import BIOCLIP_REVISION
    np.savez(seed_dir / seed.FINGERPRINTS, model=np.array(model), revision=np.array(revision or BIOCLIP_REVISION),
             photo_ids=np.array(ids, dtype=np.int64), vectors=np.full((len(ids), 8), 0.5, np.float32))


def demo_mode(tmp_path):
    """No species model on this PC (like a fresh install without PyTorch)."""
    cfg = pipeline.VISION.cfg
    pipeline.set_vision(pipeline.Vision(replace(cfg, species=replace(cfg.species, model_dir=tmp_path / "none"))))
    assert not pipeline.VISION.species_installed


def test_saved_fingerprints_round_trip(tmp_path):
    write_prints(tmp_path, [1, 2])
    fp = seed.load_fingerprints(tmp_path)
    assert fp.model == "BioCLIP 2" and set(fp.vectors) == {1, 2} and fp.vectors[1].shape == (8,)
    assert seed.load_fingerprints(tmp_path / "nowhere") is None


def test_a_fresh_pc_shows_the_pictures_without_the_species_model(api, tmp_path):
    client, db, manifest = api
    write_prints(pipeline.VISION.cfg.species.seed_dir, [1, 2, 3])
    demo_mode(tmp_path)
    assert pipeline.seed_default_references(db, tmp_path / "data", manifest) == 3
    assert (count(client, "cunner"), count(client, "cod")) == (2, 1)
    vectors = db.reference_vectors("BioCLIP 2")  # stored under the real model's name, ready for matching
    assert len(vectors) == 3 and float(vectors[0][1][0]) == 0.5


def test_fingerprints_from_another_model_version_are_not_used(api, tmp_path):
    client, db, manifest = api
    write_prints(pipeline.VISION.cfg.species.seed_dir, [1, 2, 3], revision="some-other-version")
    cfg = pipeline.VISION.cfg
    demo_mode(tmp_path)
    assert pipeline.seed_default_references(db, tmp_path / "data", manifest) == 0  # waits for the model
    assert count(client, "cunner") == 0
    pipeline.set_vision(pipeline.Vision(cfg, encoder=FakeEncoder()))  # the model is installed later
    assert pipeline.seed_default_references(db, tmp_path / "data", manifest) == 3  # now worked out with it
