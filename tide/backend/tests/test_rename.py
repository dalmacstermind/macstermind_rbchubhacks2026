"""After the rename to TIDE, a database saved by an earlier version (fincount.db) carries over."""
import importlib

from fastapi.testclient import TestClient

from tide_api.db import Database, move_old_database


def test_old_database_file_is_renamed_with_its_side_files(tmp_path):
    for name in ("fincount.db", "fincount.db-wal", "fincount.db-shm"):
        (tmp_path / name).write_bytes(b"x")
    move_old_database(tmp_path)
    assert sorted(p.name for p in tmp_path.iterdir()) == ["tide.db", "tide.db-shm", "tide.db-wal"]


def test_an_existing_tide_database_is_never_replaced(tmp_path):
    (tmp_path / "fincount.db").write_bytes(b"old")
    (tmp_path / "tide.db").write_bytes(b"new")
    move_old_database(tmp_path)
    assert (tmp_path / "tide.db").read_bytes() == b"new" and (tmp_path / "fincount.db").exists()


def test_nothing_to_move(tmp_path):
    move_old_database(tmp_path)
    assert list(tmp_path.iterdir()) == []


def test_surveys_and_people_from_an_earlier_version_still_show(tmp_path, monkeypatch):
    old = Database(tmp_path / "fincount.db")
    old.run("INSERT INTO people (name, role) VALUES ('Alex', 'analyst')")
    old.conn.close()
    monkeypatch.setenv("TIDE_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("TIDE_TOKEN", "secret")
    import tide_api.main as main
    importlib.reload(main)
    client = TestClient(main.app, headers={"X-TIDE-Token": "secret"})
    assert [p["name"] for p in client.get("/people").json()] == ["Alex"]
    assert (tmp_path / "tide.db").exists() and not (tmp_path / "fincount.db").exists()
