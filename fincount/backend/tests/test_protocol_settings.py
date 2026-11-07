"""Protocol settings on the Settings screen: view, check, save, reset; each survey keeps its snapshot."""
import importlib
import time
from types import SimpleNamespace
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

from video_fixture import make_video

ALEX = {"X-FinCount-User": "Alex"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("FINCOUNT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FINCOUNT_TOKEN", "secret")
    import fincount_api.main as main
    import fincount_api.pipeline as pipeline
    monkeypatch.setattr(pipeline, "time", SimpleNamespace(sleep=lambda s: None))  # skip the demo stub's pauses
    importlib.reload(main)
    c = TestClient(main.app, headers={"X-FinCount-Token": "secret"})
    c.post("/people", json={"name": "Alex", "role": "monitoring lead"})
    return c


def restart(tmp_path) -> TestClient:
    """A fresh API process on the same data folder (like closing and reopening TIDE)."""
    import fincount_api.main as main
    importlib.reload(main)
    return TestClient(main.app, headers={"X-FinCount-Token": "secret"})


def values(client) -> dict:
    return client.get("/settings/protocol").json()["values"]


def edited(client, **changes) -> dict:
    body = values(client)
    body.update(changes)
    return body


def analyse(client, *files) -> int:
    job = client.post("/analyses", json={"site": "Mahone Bay", "files": [str(f) for f in files]}).json()
    for _ in range(600):
        if job["state"] != "running":
            break
        time.sleep(0.05)
        job = client.get(f"/analyses/{job['jobId']}").json()
    assert job["state"] == "done", job
    return job["surveyId"]


# ── Viewing and checking ──

def test_shows_the_shipped_defaults(client):
    s = client.get("/settings/protocol").json()
    assert s["source"] == "default" and s["changedBy"] == "" and s["warning"] == ""
    v = s["values"]
    assert (v["trimStartS"], v["trimEndS"], v["lengthS"], v["intervalS"], v["contextS"]) == (60, 60, 900, 60, 5)
    assert (v["toleranceS"], v["maxToleranceS"], v["firstPointOffsetS"], v["maxExtraSettleS"]) == (0.5, 1, 0, 240)
    assert (v["qcSamplePct"], v["qcMaxDiffPct"], v["qcAgreementPct"]) == (10, 6, 95)
    assert v["pointsPerWindow"] == 15
    assert s["defaults"] == v


@pytest.mark.parametrize("changes, points", [
    ({"intervalS": 30}, 30),
    ({"intervalS": 90}, 10),
    ({"lengthS": 720}, 12),
    ({"lengthS": 720, "intervalS": 60, "firstPointOffsetS": 30}, 12),
])
def test_check_reports_points_per_window_without_saving(client, tmp_path, changes, points):
    r = client.put("/settings/protocol", params={"check": "true"}, json=edited(client, **changes))
    assert r.status_code == 200 and r.json() == {"pointsPerWindow": points, "errors": {}}
    assert values(client)["intervalS"] == 60 and not (tmp_path / "protocol.yaml").exists()


@pytest.mark.parametrize("changes, field, message", [
    ({"intervalS": 0}, "intervalS", "Subsample interval must be more than 0"),
    ({"intervalS": 1000}, "intervalS", "must not be longer than the analysis window"),
    ({"lengthS": 0}, "lengthS", "Analysis window must be more than 0"),
    ({"trimStartS": -5}, "trimStartS", "Trim at the start must be at least 0"),
    ({"contextS": 0.2}, "contextS", "Context around each point must be at least the count tolerance"),
    ({"toleranceS": 1.5}, "toleranceS", "Count tolerance must not be more than the protocol's limit of ±1 s"),
    ({"firstPointOffsetS": 60}, "firstPointOffsetS", "must be less than the subsample interval"),
    ({"qcSamplePct": 0}, "qcSamplePct", "QC sample must be more than 0% and at most 100%"),
    ({"qcSamplePct": 150}, "qcSamplePct", "QC sample must be more than 0% and at most 100%"),
    ({"qcAgreementPct": 40}, "qcAgreementPct", "QC agreement target must be from 50% to 100%"),
    ({"qcMaxDiffPct": 101}, "qcMaxDiffPct", "QC maximum difference must be a percentage from 0 to 100"),
])
def test_check_explains_what_is_wrong_per_field(client, changes, field, message):
    r = client.put("/settings/protocol", params={"check": "true"}, json=edited(client, **changes))
    assert r.status_code == 200
    errors = r.json()["errors"]
    assert list(errors) == [field] and message in errors[field]
    assert r.json()["pointsPerWindow"] is None


# ── Saving and resetting ──

def test_save_needs_someone_on_the_people_list(client):
    for headers in ({}, {"X-FinCount-User": "Nobody"}):
        r = client.put("/settings/protocol", json=edited(client, intervalS=30), headers=headers)
        assert r.status_code == 400 and "who's working" in r.json()["detail"]
    assert values(client)["intervalS"] == 60


def test_save_rejects_values_that_break_a_rule(client, tmp_path):
    r = client.put("/settings/protocol", json=edited(client, contextS=0.2), headers=ALEX)
    assert r.status_code == 422 and "Context around each point" in r.json()["detail"]
    assert not (tmp_path / "protocol.yaml").exists()


def test_save_is_kept_in_the_data_folder_and_survives_a_restart(client, tmp_path):
    r = client.put("/settings/protocol", json=edited(client, intervalS=30, qcSamplePct=20), headers=ALEX)
    assert r.status_code == 200
    s = r.json()
    assert s["source"] == "custom" and s["changedBy"] == "Alex" and s["changedAt"]
    assert (s["values"]["intervalS"], s["values"]["pointsPerWindow"], s["values"]["qcSamplePct"]) == (30, 30, 20)
    saved = (tmp_path / "protocol.yaml").read_text(encoding="utf-8")
    assert "saved from the Settings screen by Alex" in saved and "interval_s: 30" in saved
    again = restart(tmp_path).get("/settings/protocol").json()
    assert again["source"] == "custom" and again["values"]["intervalS"] == 30


def test_settings_the_screen_does_not_show_are_kept(client, tmp_path):
    client.put("/settings/protocol", json=edited(client, intervalS=30), headers=ALEX)
    saved = (tmp_path / "protocol.yaml").read_text(encoding="utf-8")
    assert "settle_threshold: 0.6" in saved and "scan_fps: 2" in saved and "0.5–1.0 m" in saved


def test_names_with_accents_can_save(client):
    client.post("/people", json={"name": "Zoë"})
    r = client.put("/settings/protocol", json=edited(client, intervalS=30), headers={"X-FinCount-User": quote("Zoë")})
    assert r.status_code == 200 and r.json()["changedBy"] == "Zoë"


def test_reset_goes_back_to_the_shipped_defaults(client, tmp_path):
    client.put("/settings/protocol", json=edited(client, intervalS=30), headers=ALEX)
    assert client.delete("/settings/protocol").status_code == 400  # who's working is required here too
    r = client.delete("/settings/protocol", headers=ALEX)
    assert r.status_code == 200
    s = r.json()
    assert s["source"] == "default" and s["values"]["intervalS"] == 60 and s["changedBy"] == "Alex"
    assert not (tmp_path / "protocol.yaml").exists()


def test_every_change_is_recorded(client, tmp_path):
    client.put("/settings/protocol", json=edited(client, intervalS=30), headers=ALEX)
    client.delete("/settings/protocol", headers=ALEX)
    from fincount_api.db import Database
    rows = Database(tmp_path / "fincount.db").all("SELECT * FROM protocol_changes ORDER BY id")
    assert [(r["changed_by"], r["action"]) for r in rows] == [("Alex", "saved"), ("Alex", "reset to defaults")]
    assert '"interval_s": 60.0' in rows[0]["old_json"] and '"interval_s": 30.0' in rows[0]["new_json"]


def test_damaged_saved_copy_falls_back_to_the_defaults_with_a_warning(client, tmp_path):
    (tmp_path / "protocol.yaml").write_text("window: [this is not right", encoding="utf-8")
    s = restart(tmp_path).get("/settings/protocol").json()
    assert s["source"] == "default" and s["values"]["intervalS"] == 60
    assert "couldn't be read" in s["warning"] and "Save the settings again" in s["warning"]


# ── Each survey keeps the values it was processed with ──

def test_a_survey_keeps_its_snapshot_when_the_settings_change(client, clear_video):
    old = analyse(client, clear_video)
    client.put("/settings/protocol", json=edited(client, lengthS=600, intervalS=30), headers=ALEX)
    new = analyse(client, clear_video)

    old_info = client.get(f"/surveys/{old}").json()["survey"]
    new_info = client.get(f"/surveys/{new}").json()["survey"]
    assert old_info["protocolRecorded"] is True and new_info["protocolRecorded"] is True
    assert (old_info["protocol"]["lengthS"], old_info["protocol"]["pointsPerWindow"]) == (900, 15)
    assert (new_info["protocol"]["lengthS"], new_info["protocol"]["pointsPerWindow"]) == (600, 20)

    old_video = client.get(f"/surveys/{old}/videos").json()[0]
    new_video = client.get(f"/surveys/{new}/videos").json()[0]
    assert old_video["proposedEndS"] - old_video["proposedStartS"] == 900
    assert new_video["proposedEndS"] - new_video["proposedStartS"] == 600
    # Confirming a window checks it against the survey's own rules, not today's settings.
    assert client.patch(f"/videos/{old_video['id']}", json={"windowStartS": 60, "windowEndS": 960},
                        headers=ALEX).status_code == 200
    r = client.patch(f"/videos/{new_video['id']}", json={"windowStartS": 60, "windowEndS": 960}, headers=ALEX)
    assert r.status_code == 422 and "must be exactly 10:00" in r.json()["detail"]
    assert client.patch(f"/videos/{new_video['id']}", json={"windowStartS": 60, "windowEndS": 660},
                        headers=ALEX).status_code == 200


def test_older_surveys_without_a_snapshot_use_the_defaults(client, tmp_path, clear_video):
    sid = analyse(client, clear_video)
    from fincount_api.db import Database
    Database(tmp_path / "fincount.db").run("UPDATE surveys SET protocol_json = NULL WHERE id = ?", sid)
    client.put("/settings/protocol", json=edited(client, lengthS=600), headers=ALEX)
    info = client.get(f"/surveys/{sid}").json()["survey"]
    assert info["protocolRecorded"] is False and info["protocol"]["lengthS"] == 900  # shipped defaults
    video = client.get(f"/surveys/{sid}/videos").json()[0]
    assert client.patch(f"/videos/{video['id']}", json={"windowStartS": 60, "windowEndS": 960},
                        headers=ALEX).status_code == 200  # the shipped 15-minute window, not today's 10 minutes


def test_qc_sample_size_comes_from_the_survey_snapshot(client, tmp_path):
    video = make_video(tmp_path / "survey.mp4", seconds=20, fps=5)  # 3 demo pictures
    client.put("/settings/protocol", json=edited(client, qcSamplePct=50), headers=ALEX)
    half = analyse(client, video)
    client.delete("/settings/protocol", headers=ALEX)  # back to 10%
    tenth = analyse(client, video)
    assert len(client.get(f"/surveys/{half}/qc").json()["sample"]) == 2   # 50% of 3, rounded
    assert len(client.get(f"/surveys/{tenth}/qc").json()["sample"]) == 1  # 10% of 3, at least 1
