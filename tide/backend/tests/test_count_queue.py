"""Counting queue: videos a person just confirmed go before counts restarted after the app closed."""
import threading
from pathlib import Path

from tide.config import load_app_config, load_protocol_config
from tide_api.db import Database
from tide_api.pipeline import Jobs


def _video(db: Database, state: str) -> int:
    survey = db.create_survey("s", 0.5, ["v.mp4"], "", "Ana")
    db.run("INSERT INTO videos (survey_id, file_name, path, duration_s, fps, proposed_start_s, proposed_end_s, "
           "proposed_reason) VALUES (?, 'v.mp4', 'v.mp4', 8, 30, 0, 8, '')", survey)
    vid = db.one("SELECT MAX(id) AS id FROM videos")["id"]
    db.set_count_state(vid, state)
    return vid


def test_interrupted_counts_restart_and_new_confirmations_go_first(tmp_path: Path):
    db = Database(tmp_path / "tide.db")
    jobs = Jobs(db, tmp_path, load_protocol_config(), load_app_config())
    interrupted = [_video(db, "running"), _video(db, "queued")]
    finished = _video(db, "done")
    order: list[int] = []
    gate, all_done = threading.Event(), threading.Event()

    def count_one(video_id: int):
        gate.wait(10)  # hold the worker until everything is queued
        order.append(video_id)
        if len(order) == 3:
            all_done.set()

    jobs._count_one = count_one
    db.run("UPDATE videos SET confirmed_at = '2026-11-07 10:00:00' WHERE id = ?", interrupted[0])
    db.run("UPDATE videos SET confirmed_at = '2026-11-07 11:00:00' WHERE id = ?", interrupted[1])
    # Newest confirmation first; "done" videos aren't counted again.
    assert jobs.resume_counts() == [interrupted[1], interrupted[0]]
    assert db.video_row(interrupted[0])["count_state"] == "queued"
    new = _video(db, "")
    jobs.count_video(new)  # a person confirmed this one while the old ones wait
    gate.set()
    assert all_done.wait(10)
    # The worker may already have taken the first restarted video; the new one still beats the other.
    assert order.index(new) < order.index(interrupted[0])
    assert finished not in order
