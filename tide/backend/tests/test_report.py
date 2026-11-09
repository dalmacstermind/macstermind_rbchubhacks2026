"""The downloadable report's numbers (species status is a human note; MeanCount stays per video)."""
import importlib

from fastapi.testclient import TestClient

from tide.count import ImageCount, TrackLabel
from tide.report import findings
from tide.results import PointResult, VideoSummary
from tide.count import PointCount


def point(no: int, per_species: dict, unknown: int = 0, invertebrates: int = 0) -> PointResult:
    total = sum(per_species.values()) + unknown
    ai = PointCount("1", no, float(no), total, invertebrates, per_species, unknown, len(per_species), None, None, None,
                    "", False)
    return PointResult(no, ai, total, invertebrates, None, "", "", False)


def video(points: list[PointResult], found: list[str]) -> VideoSummary:
    return VideoSummary(1, "a.mp4", "", "T1", "STAT 1", 60.0, 960.0, 60.0, 960.0, "", True, False, False, "Sam", "done",
                        "", points, 1.0, 1.0, found, None, None, None, None, None, False)


def image(per_species: dict, unknown: int = 0) -> ImageCount:
    return ImageCount("9", "a.jpg", sum(per_species.values()) + unknown, 0, per_species, unknown, "", False)


STATUS = {"cod": "native", "cunner": None, "bass": "invasive"}


def test_species_totals_points_and_photos():
    f = findings([video([point(1, {"cod": 2}), point(2, {"cod": 1, "cunner": 1}), point(3, {})], ["cod", "cunner"])],
                 [image({"cunner": 4})], {}, STATUS)
    rows = {r.species_id: r for r in f.species}
    assert (rows["cod"].total_at_points, rows["cod"].points_seen, rows["cod"].in_images) == (3, 2, 0)
    assert (rows["cunner"].total_at_points, rows["cunner"].points_seen, rows["cunner"].in_images) == (1, 1, 4)
    assert f.points_total == 3 and f.identified_species == 2
    assert [r.species_id for r in f.species] == ["cod", "cunner"]  # most counted first


def test_species_seen_only_by_the_scan_is_marked_and_counted_as_identified():
    f = findings([video([point(1, {})], ["bass"])], [], {}, STATUS)
    assert f.identified_species == 1 and f.species[0].seen_between_points and f.species[0].total_at_points == 0


def test_unknown_is_not_an_identified_species_but_is_counted_as_unidentified():
    f = findings([video([point(1, {"unknown": 1, "cod": 1}, unknown=2, invertebrates=1)], [])], [image({}, unknown=1)],
                 {}, STATUS)
    assert [r.species_id for r in f.species] == ["cod"]  # "unknown" isn't in the registry map
    assert f.unidentified_fish == 3 and f.invertebrates == 1


def test_status_counts_use_only_human_notes():
    f = findings([video([point(1, {"cod": 1, "cunner": 1, "bass": 1})], [])], [], {}, STATUS)
    assert (f.native_noted, f.invasive_noted, f.status_not_noted) == (1, 1, 1)


def test_ai_only_and_human_approved():
    labels = {"t1": TrackLabel("fish", "cod", True), "t2": TrackLabel("fish", "cunner", False)}
    f = findings([video([point(1, {"cod": 1, "cunner": 1})], [])], [], labels, STATUS)
    assert (f.ai_only, f.human_approved) == (1, 1)


def test_report_route_and_status_notes(tmp_path, monkeypatch):
    monkeypatch.setenv("TIDE_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("TIDE_TOKEN", raising=False)
    import tide_api.main as m
    importlib.reload(m)
    client = TestClient(m.app)
    db = m.db
    sid = db.create_survey("Bay", 0.5, ["a.jpg", "b.mp4"], "2025-08-20", "Sam", [10, 20])
    r = client.get(f"/surveys/{sid}/report").json()
    assert [f["sizeBytes"] for f in r["files"]] == [10, 20] and r["identifiedSpecies"] == 0 and not r["isSampleData"]
    assert client.get("/surveys/999/report").status_code == 404
    shipped = next(s for s in client.get("/species").json() if s["id"] != "unknown")
    assert shipped["statusNoted"] is False  # the shipped list's value isn't a human note
    after = client.patch(f"/species/{shipped['id']}", json={"status": shipped["status"]}).json()
    assert next(s for s in after if s["id"] == shipped["id"])["statusNoted"] is True  # confirmed by a person
    renamed = client.patch(f"/species/{shipped['id']}", json={"habitat": "Marine"}).json()
    assert next(s for s in renamed if s["id"] == shipped["id"])["statusNoted"] is True  # stays noted
