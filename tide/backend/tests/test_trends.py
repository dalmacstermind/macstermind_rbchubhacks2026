"""Trends page: one point per counted video, and every other video listed with its reason."""
from __future__ import annotations

from tide.ingest import recorded_date
from tide.results import VideoSummary as VideoResult
from tide.trends import (COUNTING, NO_DATE, NOT_CONFIRMED, NOT_COUNTED, NOT_REVIEWED, TOO_SHORT, TrendFilters,
                         TrendVideo, build_trends)
from tide_api.db import Database
from conftest import confirm_and_count
from test_count_controls import _analyse, _api
from test_vision import FakeDetector


def _video(video_id=1, survey_id=1, survey_date="", **changes) -> TrendVideo:
    values = dict(
        id=video_id, name=f"v{video_id}.mp4", recorded_at="2025-08-20", transect="T1", stat="STAT 1",
        window_start_s=60.0, window_end_s=960.0, proposed_start_s=60.0, proposed_end_s=960.0, proposed_reason="",
        settled=True, too_short=False, short_window=False, confirmed_by="Ana", count_state="done", count_detail="",
        points=[object()], mean_count=2.5, mean_count_ai=2.5, species_found=["cod", "cunner"], clarity_index=60.0,
        clarity_min=50.0, clarity_max=70.0, clarity_trend="stable", visibility=None, reviewed=True)
    values.update(changes)
    return TrendVideo(survey_id, "Site", survey_date, VideoResult(**values))


def test_a_counted_reviewed_video_is_one_point():
    point = build_trends([_video()], TrendFilters()).points[0]
    assert (point.video_id, point.recorded_at, point.species_found, point.clarity_index) == (1, "2025-08-20", 2, 60.0)
    assert point.label == "2025-08-20 · T1 STAT 1"


def test_points_are_in_recording_date_order():
    videos = [_video(1, recorded_at="2025-09-01"), _video(2, recorded_at="2025-08-01")]
    assert [p.video_id for p in build_trends(videos, TrendFilters()).points] == [2, 1]


def test_videos_that_were_not_counted_are_listed_never_plotted_as_zero():
    videos = [
        _video(1, too_short=True),
        _video(2, confirmed_by=""),
        _video(3, count_state="running"),
        _video(4, count_state="failed", points=[]),
        _video(5, count_state="stopped", points=[]),
    ]
    out = build_trends(videos, TrendFilters())
    assert out.points == []
    assert [n.reason for n in out.not_plotted] == [TOO_SHORT, NOT_CONFIRMED, COUNTING, NOT_COUNTED, NOT_COUNTED]
    assert "failed" in out.not_plotted[3].explanation and "stopped" in out.not_plotted[4].explanation


def test_a_video_without_a_date_is_listed_and_can_use_the_survey_date():
    undated = build_trends([_video(recorded_at="")], TrendFilters())
    assert undated.points == [] and undated.not_plotted[0].reason == NO_DATE
    dated = build_trends([_video(recorded_at="", survey_date="2025-07-04")], TrendFilters())
    assert dated.points[0].recorded_at == "2025-07-04"


def test_reviewed_only_is_on_by_default_and_ai_only_results_can_be_included():
    video = _video(reviewed=False)
    hidden = build_trends([video], TrendFilters())
    assert hidden.points == [] and hidden.not_plotted[0].reason == NOT_REVIEWED
    assert len(build_trends([video], TrendFilters(reviewed_only=False)).points) == 1


def test_filters_by_transect_stat_and_date_range_but_keep_undated_videos_listed():
    videos = [_video(1), _video(2, transect="T2"), _video(3, stat="STAT 2"), _video(4, recorded_at="2025-10-01"),
              _video(5, recorded_at="")]
    out = build_trends(videos, TrendFilters(transect="T1", stat="STAT 1", date_to="2025-09-01"))
    assert [p.video_id for p in out.points] == [1]
    assert [n.video_id for n in out.not_plotted] == [5]
    assert (out.transects, out.stats) == (["T1", "T2"], ["STAT 1", "STAT 2"])  # the filters still offer every value


def test_group_by_survey_date_gives_mean_range_and_number_of_videos():
    videos = [
        _video(1, clarity_index=40.0, species_found=["a"], mean_count=1.0),
        _video(2, clarity_index=60.0, species_found=["a", "b", "c"], mean_count=3.0),
        _video(3, recorded_at="2025-09-01", clarity_index=None),
    ]
    first, second = build_trends(videos, TrendFilters(), group_by_survey=True).groups
    assert (first.recorded_at, first.videos, first.clarity_mean, first.clarity_min, first.clarity_max) == (
        "2025-08-20", 2, 50.0, 40.0, 60.0)
    assert (first.species_mean, first.species_min, first.species_max, first.mean_count) == (2.0, 1, 3, 2.0)
    assert second.clarity_mean is None and second.videos == 1


def test_short_windows_are_plotted_and_marked():
    assert build_trends([_video(short_window=True)], TrendFilters()).points[0].short_window is True


def test_recording_date_comes_from_folders_never_the_file_name():
    assert str(recorded_date("Fall 2025/August 20_2025/T1/STAT 1/x.mp4")) == "2025-08-20"
    assert recorded_date("Downloads/vlc-record-2026-11-07-T1-STAT2.mp4") is None


def test_dates_already_read_from_file_names_are_removed_once(tmp_path):
    path = tmp_path / "tide.db"
    db = Database(path)
    sid = db.create_survey("Site", 0.5, ["a.mp4"], survey_date="2025-07-04")
    add = ("INSERT INTO videos (survey_id, file_name, path, duration_s, fps, recorded_at, too_short, proposed_reason) "
           "VALUES (?, ?, ?, 60, 30, ?, 0, '')")
    from_name = db.run(add, sid, "vlc-record-2026-11-07.mp4", "Downloads/vlc-record-2026-11-07.mp4", "2026-11-07")
    from_folder = db.run(add, sid, "x-2025-08-20.mp4", "2025-08-20/x-2025-08-20.mp4", "2025-08-20")
    typed = db.run(add, sid, "vlc-record-2026-11-07 b.mp4", "Downloads/vlc-record-2026-11-07 b.mp4", "2026-01-02")
    db.run("PRAGMA user_version = 0")  # as an older database

    db = Database(path)
    dates = {r["id"]: r["recorded_at"] for r in db.all("SELECT id, recorded_at FROM videos")}
    assert dates == {from_name: "", from_folder: "2025-08-20", typed: "2026-01-02"}

    db.run("UPDATE videos SET recorded_at = '2026-11-07' WHERE id = ?", from_name)  # a person chose this date
    assert Database(path).video_row(from_name)["recorded_at"] == "2026-11-07"  # only ever done once


def test_trends_route(tmp_path, monkeypatch, synthetic_video):
    _, client = _api(tmp_path, monkeypatch, FakeDetector())
    sid = _analyse(client, synthetic_video)
    row = client.get("/trends").json()["notPlotted"][0]
    assert (row["surveyId"], row["reason"]) == (sid, NOT_CONFIRMED)

    res = confirm_and_count(client, sid)
    video_id = res["videos"][0]["id"]
    client.patch(f"/videos/{video_id}/details", json={"recordedAt": "2025-08-20"})
    query = "reviewedOnly=false&groupBySurvey=true&from=2025-01-01"
    body = client.get(f"/trends?{query}").json()
    assert [p["videoId"] for p in body["points"]] == [video_id] and body["groups"][0]["videos"] == 1
    assert client.get(f"/trends?{query}&to=2025-02-01").json()["points"] == []
