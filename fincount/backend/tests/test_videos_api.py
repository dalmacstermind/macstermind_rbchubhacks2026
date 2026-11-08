"""Analysis window over the API: proposed during processing, confirmed by a named person."""
import importlib
import time
from types import SimpleNamespace
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("FINCOUNT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FINCOUNT_TOKEN", "secret")
    import fincount_api.main as main
    import fincount_api.pipeline as pipeline
    monkeypatch.setattr(pipeline, "time", SimpleNamespace(sleep=lambda s: None))  # skip the demo stub's pauses
    importlib.reload(main)
    # These tests check the strict rule (window.allow_short_videos: false); test_short_videos.py checks the default.
    from dataclasses import replace
    strict = replace(main.protocol, window=replace(main.protocol.window, allow_short_videos=False))
    main.protocol = main.jobs.protocol = strict
    c = TestClient(main.app, headers={"X-FinCount-Token": "secret"})
    c.post("/people", json={"name": "Alex", "role": "analyst"})
    return c


def analyse(client, *files):
    job = client.post("/analyses", json={"site": "Mahone Bay", "files": [str(f) for f in files]}).json()
    for _ in range(600):
        if job["state"] != "running":
            break
        time.sleep(0.1)
        job = client.get(f"/analyses/{job['jobId']}").json()
    assert job["state"] == "done", job
    return job


def videos_by_name(client, survey_id):
    r = client.get(f"/surveys/{survey_id}/videos")
    assert r.status_code == 200
    return {v["fileName"]: v for v in r.json()}


def confirm(client, video_id, start, end, person="Alex"):
    headers = {"X-FinCount-User": quote(person)} if person is not None else {}
    return client.patch(f"/videos/{video_id}", json={"windowStartS": start, "windowEndS": end}, headers=headers)


@pytest.fixture()
def survey(client, sediment_2min_video, synthetic_video, short_sediment_video):
    job = analyse(client, sediment_2min_video, synthetic_video, short_sediment_video)
    return job, videos_by_name(client, job["surveyId"])


def test_processing_proposes_a_window_but_never_confirms_it(survey):
    job, videos = survey
    v = videos["sediment_2min.mp4"]
    assert 120 <= v["proposedStartS"] <= 125 and v["proposedEndS"] == v["proposedStartS"] + 900
    assert v["settled"] is True and v["tooShort"] is False
    assert "later start is suggested" in v["proposedReason"]
    assert (v["windowStartS"], v["windowEndS"], v["confirmedBy"]) == (None, None, "")
    detail = {f["name"]: f["detail"] for f in job["files"]}
    assert "waiting for confirmation" in detail["sediment_2min.mp4"]


def test_short_video_is_flagged_and_cannot_be_confirmed(client, survey):
    job, videos = survey
    short = videos["T1_STAT1_GX010021.mp4"]
    assert short["tooShort"] is True and short["proposedStartS"] is None
    assert "too short for the protocol (flagged)" in {f["name"]: f["detail"] for f in job["files"]}[short["fileName"]]
    r = confirm(client, short["id"], 60, 960)
    assert r.status_code == 422 and "too short" in r.json()["detail"]


def test_confirming_saves_the_window_and_who_did_it(client, survey):
    _, videos = survey
    v = videos["sediment_2min.mp4"]
    r = confirm(client, v["id"], 125, 1025)
    assert r.status_code == 200
    saved = r.json()
    assert (saved["windowStartS"], saved["windowEndS"], saved["confirmedBy"]) == (125, 1025, "Alex")
    assert saved["confirmedAt"]
    assert saved["proposedStartS"] == v["proposedStartS"]  # the proposal is kept
    assert videos_by_name(client, v["surveyId"])["sediment_2min.mp4"]["windowStartS"] == 125


def test_confirmed_window_survives_a_restart(client, survey, tmp_path):
    _, videos = survey
    v = videos["sediment_2min.mp4"]
    confirm(client, v["id"], 60, 960)
    from fincount_api.db import Database
    again = Database(tmp_path / "fincount.db").get_video(int(v["id"]))
    assert (again.window_start_s, again.window_end_s, again.confirmed_by) == (60, 960, "Alex")


def test_snake_case_body_is_accepted_too(client, survey):
    _, videos = survey
    r = client.patch(f"/videos/{videos['sediment_2min.mp4']['id']}", json={"window_start_s": 60, "window_end_s": 960},
                     headers={"X-FinCount-User": "Alex"})
    assert r.status_code == 200


def test_names_with_accents_are_recorded(client, survey):
    client.post("/people", json={"name": "Zoë"})
    _, videos = survey
    r = confirm(client, videos["sediment_2min.mp4"]["id"], 60, 960, person="Zoë")
    assert r.status_code == 200 and r.json()["confirmedBy"] == "Zoë"


@pytest.mark.parametrize("start, end, message", [
    (30, 930, "can't start before 01:00"),
    (301, 1201, "can't start after 05:00"),
    (60, 900, "must be exactly 15:00.0 long"),
    (100, 90, "must end after it starts"),
])
def test_bad_times_are_rejected_with_a_reason(client, survey, start, end, message):
    _, videos = survey
    r = confirm(client, videos["sediment_2min.mp4"]["id"], start, end)
    assert r.status_code == 422 and message in r.json()["detail"]


def test_window_must_end_a_minute_before_the_video_does(client, survey):
    _, videos = survey
    r = confirm(client, videos["short_sediment.mp4"]["id"], 200, 1100)  # 18-min video: must end by 17:00
    assert r.status_code == 422 and "must end by 17:00.0" in r.json()["detail"]


@pytest.mark.parametrize("person", [None, "", "Nobody we know"])
def test_must_say_who_is_working(client, survey, person):
    _, videos = survey
    r = confirm(client, videos["sediment_2min.mp4"]["id"], 60, 960, person=person)
    assert r.status_code == 400 and "who's working" in r.json()["detail"]


def test_missing_times_or_unknown_video(client, survey):
    _, videos = survey
    vid = videos["sediment_2min.mp4"]["id"]
    assert client.patch(f"/videos/{vid}", json={"windowStartS": 60}, headers={"X-FinCount-User": "Alex"}) \
        .status_code == 422
    assert confirm(client, 999999, 60, 960).status_code == 404
    assert client.get("/surveys/999999/videos").status_code == 404


def test_deleting_a_survey_deletes_its_videos(client, survey):
    job, _ = survey
    assert client.delete(f"/surveys/{job['surveyId']}").status_code == 204
    assert client.get(f"/surveys/{job['surveyId']}/videos").status_code == 404
