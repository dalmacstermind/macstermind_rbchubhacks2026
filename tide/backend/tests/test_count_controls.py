"""Stopping a count, counting again, counts interrupted by closing TIDE, and windows still to confirm.

Uses the synthetic 3-minute video, the short test protocol and the TEST-ONLY detector (see
test_protocol_results.py). A slow detector keeps the count running long enough to stop it.
"""
import importlib
import threading
import time
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

from tide.config import load_vision_config
from tide_api.pipeline import count_progress_text
from conftest import confirm_and_count, use_short_protocol
from test_vision import FakeDetector, FakeEncoder

ANA = {"X-TIDE-User": quote("Ana")}


class SlowDetector(FakeDetector):
    """TEST ONLY. Waits until the test lets it go, so a count stays running."""

    def __init__(self):
        self.started = threading.Event()
        self.go = threading.Event()

    def detect(self, image, frame_idx=0, t_s=0.0, enhance=False):
        self.started.set()
        self.go.wait(0.05)
        return super().detect(image, frame_idx, t_s, enhance)


def _api(tmp_path, monkeypatch, detector):
    monkeypatch.setenv("TIDE_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("TIDE_TOKEN", "")
    import tide_api.main as main
    from tide_api import pipeline
    importlib.reload(main)
    use_short_protocol(main)
    pipeline.set_vision(pipeline.Vision(load_vision_config(), detector=detector, encoder=FakeEncoder()))
    client = TestClient(main.app)
    client.post("/people", json={"name": "Ana"})
    return main, client


def _analyse(client, video) -> int:
    job = client.post("/analyses", json={"site": "T", "files": [str(video)], "ignoreSpecks": False}).json()
    for _ in range(3600):
        job = client.get(f"/analyses/{job['jobId']}").json()
        if job["state"] != "running":
            break
        time.sleep(0.05)
    assert job["state"] == "done", job
    return job["surveyId"]


def _video(client, sid) -> dict:
    return client.get(f"/surveys/{sid}/results").json()["videos"][0]


def _wait(client, sid, states, seconds=60) -> dict:
    for _ in range(int(seconds / 0.05)):
        v = _video(client, sid)
        if v["countState"] in states:
            return v
        time.sleep(0.05)
    raise AssertionError(f"count never reached {states}: {_video(client, sid)}")


def _survey(client, sid) -> dict:
    return next(s for s in client.get("/surveys").json() if s["id"] == sid)


def test_windows_to_confirm_until_a_person_confirms(tmp_path, monkeypatch, synthetic_video):
    _, client = _api(tmp_path, monkeypatch, FakeDetector())
    sid = _analyse(client, synthetic_video)
    assert _survey(client, sid)["windowsToConfirm"] == 1
    assert client.get(f"/surveys/{sid}").json()["survey"]["windowsToConfirm"] == 1
    confirm_and_count(client, sid)
    assert _survey(client, sid)["windowsToConfirm"] == 0


def test_survey_and_counts_say_what_is_not_counted_yet(tmp_path, monkeypatch, synthetic_video):
    _, client = _api(tmp_path, monkeypatch, FakeDetector())
    sid = _analyse(client, synthetic_video)
    s = _survey(client, sid)
    assert (s["videosToCount"], s["videosCounting"]) == (1, 0)  # processed is not the same as counted
    assert client.get("/counts").json() == []
    confirm_and_count(client, sid)
    s = _survey(client, sid)
    assert (s["videosToCount"], s["videosCounting"]) == (0, 0)
    row = next(c for c in client.get("/counts").json() if c["surveyId"] == sid)
    assert row["state"] == "done" and row["fileName"] and "points" in row["detail"]


@pytest.mark.parametrize("fraction, elapsed, expected", [
    (0.01, 100, "Counting the points: 1%"),  # too early to guess
    (0.5, 20, "Counting the points: 50% · less than a minute left"),
    (0.25, 600, "Counting the points: 25% · about 30 min left"),
    (0.25, 1600, "Counting the points: 25% · about 1 h 20 min left"),
])
def test_count_progress_text_gives_the_time_left(fraction, elapsed, expected):
    assert count_progress_text(fraction, elapsed) == expected


def test_stop_a_running_count_then_count_again(tmp_path, monkeypatch, synthetic_video):
    slow = SlowDetector()
    _, client = _api(tmp_path, monkeypatch, slow)
    sid = _analyse(client, synthetic_video)
    v = _video(client, sid)
    assert client.patch(f"/videos/{v['id']}", json={"windowStartS": 10, "windowEndS": 70}, headers=ANA).status_code == 200
    assert slow.started.wait(30)
    _wait(client, sid, ("running",))

    # Stopping needs who's working, and only works while counting.
    assert client.post(f"/videos/{v['id']}/count/stop").status_code == 400
    assert client.post(f"/videos/{v['id']}/count/stop", headers=ANA).status_code == 204
    v = _wait(client, sid, ("stopped",))
    assert v["countDetail"] == "Counting stopped by Ana" and v["points"] == []  # nothing half-saved
    assert client.post(f"/videos/{v['id']}/count/stop", headers=ANA).status_code == 409

    # Count again: the same confirmed window, counted from the start.
    slow.go.set()
    assert client.post(f"/videos/{v['id']}/count", headers=ANA).status_code == 204
    v = _wait(client, sid, ("done", "failed"))
    assert v["countState"] == "done" and [p["pointNo"] for p in v["points"]] == [1, 2, 3]


def test_count_again_needs_a_confirmed_window_and_no_count_running(tmp_path, monkeypatch, synthetic_video):
    slow = SlowDetector()
    _, client = _api(tmp_path, monkeypatch, slow)
    sid = _analyse(client, synthetic_video)
    vid = _video(client, sid)["id"]
    r = client.post(f"/videos/{vid}/count", headers=ANA)
    assert r.status_code == 422 and "Confirm the analysis window" in r.json()["detail"]
    client.patch(f"/videos/{vid}", json={"windowStartS": 10, "windowEndS": 70}, headers=ANA)
    assert slow.started.wait(30)
    assert client.post(f"/videos/{vid}/count", headers=ANA).status_code == 409
    slow.go.set()
    assert _wait(client, sid, ("done", "failed"))["countState"] == "done"
    assert client.post(f"/videos/{vid}/count/stop", headers=ANA).status_code == 409


def test_a_waiting_count_stops_straight_away(tmp_path, monkeypatch, synthetic_video):
    main, client = _api(tmp_path, monkeypatch, FakeDetector())
    sid = _analyse(client, synthetic_video)
    vid = int(_video(client, sid)["id"])
    main.db.confirm_window(vid, 10, 70, "Ana")
    # Fill the queue's place without a worker picking it up: the count stays "queued".
    from tide_api.pipeline import _CountRun
    with main.jobs.lock:
        main.jobs._count_runs[vid] = _CountRun()
    main.db.set_count_state(vid, "queued", "Waiting to count")
    assert main.jobs.stop_count(vid, "Ana")
    v = _video(client, sid)
    assert (v["countState"], v["countDetail"]) == ("stopped", "Counting stopped by Ana")
    assert not main.jobs.is_counting(vid)


def test_counts_interrupted_by_closing_tide_are_marked_stopped(tmp_path, monkeypatch, synthetic_video):
    main, client = _api(tmp_path, monkeypatch, FakeDetector())
    sid = _analyse(client, synthetic_video)
    vid = int(_video(client, sid)["id"])
    main.db.confirm_window(vid, 10, 70, "Ana")
    main.db.set_count_state(vid, "running", "Counting the points: 5%")  # TIDE closed at 5%
    main.db.conn.close()

    importlib.reload(main)  # TIDE starts again
    client = TestClient(main.app)
    v = _video(client, sid)
    assert v["countState"] == "stopped" and "interrupted because TIDE closed" in v["countDetail"]
    client.post("/people", json={"name": "Ana"})
    assert client.post(f"/videos/{vid}/count", headers=ANA).status_code == 204
    assert _wait(client, sid, ("done", "failed"))["countState"] in ("done", "failed")



def test_count_progress_text_names_the_stage():
    assert count_progress_text(0.93, 140, "Identifying the species") == (
        "Identifying the species: 93% · less than a minute left")
