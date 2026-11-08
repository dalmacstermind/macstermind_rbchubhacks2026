"""Database part for protocol results: videos, subsample points and staff labels.

Mixed into `Database` (db.py). The AI's own output is never overwritten: staff edits to points are
stored next to the AI values, and labels are stored as their own rows (with what they replaced, so
every label can be undone).
"""
from __future__ import annotations

import json
import uuid

from tide.ingest import date_in_text, recorded_date

PROTOCOL_SCHEMA = """
CREATE TABLE IF NOT EXISTS points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  point_no INTEGER NOT NULL, timestamp_s REAL NOT NULL, clip_path TEXT NOT NULL DEFAULT '',
  human_total_fish INTEGER, human_invertebrates INTEGER,
  visibility TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  edited_by TEXT NOT NULL DEFAULT '', edited_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL, action TEXT NOT NULL, species TEXT, invertebrate_type TEXT,
  box_source TEXT NOT NULL DEFAULT 'ai', frame_id INTEGER, ai_label TEXT NOT NULL DEFAULT '',
  ai_top_k TEXT NOT NULL DEFAULT '[]', use_as_reference INTEGER NOT NULL DEFAULT 0,
  previous TEXT NOT NULL DEFAULT '[]', labelled_by TEXT NOT NULL DEFAULT '',
  labelled_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), undone INTEGER NOT NULL DEFAULT 0
);
"""

PROTOCOL_MIGRATIONS = [
    # Added to the videos table (db.py, US-2.1): details read from the path, and point counting status.
    ("videos", "recorded_at", "TEXT NOT NULL DEFAULT ''"),
    ("videos", "transect", "TEXT NOT NULL DEFAULT ''"),
    ("videos", "stat", "TEXT NOT NULL DEFAULT ''"),
    ("videos", "visibility", "TEXT NOT NULL DEFAULT ''"),
    ("videos", "file_key", "TEXT NOT NULL DEFAULT ''"),
    ("videos", "count_state", "TEXT NOT NULL DEFAULT ''"),  # "" | "queued" | "running" | "done" | "failed"
    ("videos", "count_detail", "TEXT NOT NULL DEFAULT ''"),
    ("videos", "count_percent", "REAL"),  # 0–100 while counting (None when not counting)
    ("videos", "count_eta_s", "REAL"),  # estimated seconds left (None until it can be estimated)
    ("videos", "short_window", "INTEGER NOT NULL DEFAULT 0"),  # shorter than the protocol window (not comparable)
    # The settings a survey started with, so counting after a window is confirmed uses the same ones.
    ("surveys", "enhance", "INTEGER NOT NULL DEFAULT 1"),
    ("surveys", "ignore_specks", "INTEGER NOT NULL DEFAULT 1"),
    ("surveys", "look_closer", "INTEGER NOT NULL DEFAULT 0"),
    ("surveys", "tracker", "TEXT NOT NULL DEFAULT ''"),
    # Picture filters, per picture and per detection
    ("frames", "quality", "TEXT NOT NULL DEFAULT ''"),  # clear | moderate | muddy | obscured
    ("frames", "quality_score", "REAL"),
    ("frames", "quality_reasons", "TEXT NOT NULL DEFAULT ''"),
    ("frames", "static", "INTEGER NOT NULL DEFAULT 0"),  # boxes carried over from the last searched picture
    ("detections", "drift", "INTEGER NOT NULL DEFAULT 0"),  # the track moved like the water (review)
    ("frames", "video_id", "INTEGER"),
    ("frames", "point_no", "INTEGER"),
    ("frames", "t_s", "REAL"),
    ("frames", "role", "TEXT NOT NULL DEFAULT 'sample'"),  # "point" | "scan" | "photo" | "sample" (demo)
    ("detections", "box_source", "TEXT NOT NULL DEFAULT 'ai'"),  # "ai" | "human_drawn"
]


# PRAGMA user_version once the recording dates read from file names have been removed.
FILE_NAME_DATES_REMOVED = 1

INTERRUPTED = "Counting was interrupted because TIDE closed. Nothing was saved: count again to start over."


class ProtocolStore:
    """Methods for videos, points and labels (uses Database.run/all/one)."""

    def remove_file_name_dates(self):
        """Once per database: recording dates used to be read from file names too, which is often when a clip
        was saved or exported. Those are blanked, so the survey's date applies until staff enter one."""
        if self.one("PRAGMA user_version")["user_version"] >= FILE_NAME_DATES_REMOVED:
            return
        for v in self.all("SELECT id, file_name, path, recorded_at FROM videos WHERE recorded_at <> ''"):
            in_name = date_in_text(v["file_name"])
            if in_name and in_name.isoformat() == v["recorded_at"] and recorded_date(v["path"]) is None:
                self.run("UPDATE videos SET recorded_at = '' WHERE id = ?", v["id"])
        self.run(f"PRAGMA user_version = {FILE_NAME_DATES_REMOVED}")

    # ── videos and points ──

    def set_video_details(self, video_id: int, file_key: str, recorded_at: str, transect: str, stat: str):
        self.run("UPDATE videos SET file_key = ?, recorded_at = ?, transect = ?, stat = ? WHERE id = ?",
                 file_key, recorded_at, transect, stat, video_id)

    def set_count_state(self, video_id: int, state: str, detail: str = "", percent: float | None = None,
                        eta_s: float | None = None):
        self.run("UPDATE videos SET count_state = ?, count_detail = ?, count_percent = ?, count_eta_s = ? "
                 "WHERE id = ?", state, detail, percent, eta_s, video_id)

    def stop_interrupted_counts(self):
        """At start-up: a count that was waiting or running when TIDE closed can't carry on, so it is
        marked stopped (otherwise the report would say "Counting…" forever). Nothing of it was saved."""
        self.run("UPDATE videos SET count_state = 'stopped', count_detail = ?, count_percent = NULL, "
                 "count_eta_s = NULL "
                 "WHERE count_state IN ('queued', 'running')", INTERRUPTED)

    def clear_video_counts(self, video_id: int):
        """Before counting a (re)confirmed window: remove the previous count's points, pictures and labels."""
        r = self.video_row(video_id)
        if not r:
            return []
        frames = self.all("SELECT image_path FROM frames WHERE video_id = ?", video_id)
        tracks = [t["track_id"] for t in self.all(
            "SELECT DISTINCT d.track_id FROM detections d JOIN frames f ON f.id = d.frame_id WHERE f.video_id = ?",
            video_id)]
        with self.lock, self.conn:
            self.conn.execute("DELETE FROM points WHERE video_id = ?", (video_id,))
            self.conn.execute("DELETE FROM frames WHERE video_id = ?", (video_id,))
            self.conn.executemany("DELETE FROM track_vectors WHERE survey_id = ? AND track_id = ?",
                                  [(r["survey_id"], t) for t in tracks])
            self.conn.executemany("DELETE FROM labels WHERE survey_id = ? AND track_id = ?",
                                  [(r["survey_id"], t) for t in tracks])
        return [f["image_path"] for f in frames]

    def add_point(self, video_id: int, point_no: int, timestamp_s: float, clip_path: str) -> int:
        return self.run("INSERT INTO points (video_id, point_no, timestamp_s, clip_path) VALUES (?,?,?,?)",
                        video_id, point_no, timestamp_s, clip_path)

    def video_rows(self, survey_id: int):
        return self.all("SELECT * FROM videos WHERE survey_id = ? ORDER BY id", survey_id)

    def video_row(self, video_id: int):
        return self.one("SELECT * FROM videos WHERE id = ?", video_id)

    def points(self, video_id: int):
        return self.all("SELECT * FROM points WHERE video_id = ? ORDER BY point_no", video_id)

    def point(self, point_id: int):
        return self.one("SELECT p.*, v.survey_id FROM points p JOIN videos v ON v.id = p.video_id WHERE p.id = ?",
                        point_id)

    def update_video_details(self, video_id: int, fields: dict) -> bool:
        """Recording date, Transect, STAT and confirmed visibility (the window is confirm_window in db.py)."""
        allowed = {"recorded_at", "transect", "stat", "visibility"}
        sets = {k: v for k, v in fields.items() if k in allowed and v is not None}
        if not self.video_row(video_id):
            return False
        for k, v in sets.items():
            self.run(f"UPDATE videos SET {k} = ? WHERE id = ?", v, video_id)
        return True

    def update_point(self, point_id: int, fields: dict, by: str) -> bool:
        """Staff review of a point. The AI's values are kept; these are stored next to them.
        A value of -1 for a count clears the staff value (back to the AI's)."""
        if not self.point(point_id):
            return False
        for k in ("human_total_fish", "human_invertebrates"):
            if fields.get(k) is not None:
                self.run(f"UPDATE points SET {k} = ? WHERE id = ?", None if fields[k] < 0 else fields[k], point_id)
        for k in ("visibility", "notes"):
            if fields.get(k) is not None:
                self.run(f"UPDATE points SET {k} = ? WHERE id = ?", fields[k], point_id)
        self.run("UPDATE points SET edited_by = ?, edited_at = datetime('now','localtime') WHERE id = ?", by, point_id)
        return True

    # ── what results are built from ──

    def video_sightings(self, video_id: int):
        """Every detection of one video with the picture it was in (role, point, time, clarity)."""
        return self.all("SELECT d.id, d.track_id, d.confidence, d.species_id, d.model_species_id, d.verified, "
                        "d.ai_label, d.top_k, d.unknown_reason, d.x, d.y, d.w, d.h, d.drift, f.id AS frame_id, "
                        "f.role, f.point_no, f.t_s, f.timestamp, f.source, f.quality FROM detections d JOIN frames f "
                        "ON f.id = d.frame_id WHERE f.video_id = ? ORDER BY d.id", video_id)

    def point_frames(self, video_id: int, point_no: int):
        return self.all("SELECT id, t_s, clarity, timestamp FROM frames WHERE video_id = ? AND point_no = ? "
                        "AND role = 'point' ORDER BY t_s", video_id, point_no)

    def photo_sightings(self, survey_id: int):
        return self.all("SELECT d.id, d.track_id, d.confidence, d.species_id, d.model_species_id, d.verified, "
                        "d.ai_label, d.top_k, d.unknown_reason, d.x, d.y, d.w, d.h, f.id AS frame_id, f.source "
                        "FROM frames f LEFT JOIN detections d ON d.frame_id = f.id "
                        "WHERE f.survey_id = ? AND f.role = 'photo' ORDER BY f.id, d.id", survey_id)

    def survey_detections(self, survey_id: int):
        return self.all("SELECT d.*, f.role, f.point_no, f.t_s, f.timestamp, f.source, f.video_id, f.id AS fid "
                        "FROM detections d JOIN frames f ON f.id = d.frame_id WHERE f.survey_id = ? ORDER BY d.id",
                        survey_id)

    def track_crop(self, survey_id: int, track_id: str) -> str:
        r = self.one("SELECT crop_path FROM track_vectors WHERE survey_id = ? AND track_id = ?", survey_id, track_id)
        return r["crop_path"] if r else ""

    # ── labels (always reversible; the AI's result is never overwritten) ──

    def active_labels(self, survey_id: int):
        """The latest label per track that hasn't been undone."""
        return self.all("SELECT * FROM labels WHERE survey_id = ? AND undone = 0 AND id IN "
                        "(SELECT MAX(id) FROM labels WHERE survey_id = ? AND undone = 0 GROUP BY track_id)",
                        survey_id, survey_id)

    def add_label(self, survey_id: int, track_id: str, action: str, species: str | None, invertebrate_type: str | None,
                  box_source: str, frame_id: int | None, use_as_reference: bool, by: str,
                  mirror_species_id: str) -> int:
        """Store a label and show it on every picture of the track (the "Check the fish" view).

        What the pictures said before is saved in the label, so undo puts it back exactly.
        """
        rows = self.all("SELECT d.id, d.species_id, d.verified, d.edited_by, d.ai_label, d.top_k FROM detections d "
                        "JOIN frames f ON f.id = d.frame_id WHERE f.survey_id = ? AND d.track_id = ?",
                        survey_id, track_id)
        previous = [[r["id"], r["species_id"], r["verified"], r["edited_by"]] for r in rows]
        ai_label = rows[0]["ai_label"] if rows else ""
        ai_top_k = rows[0]["top_k"] if rows else "[]"
        with self.lock, self.conn:
            label_id = self.conn.execute(
                "INSERT INTO labels (survey_id, track_id, action, species, invertebrate_type, box_source, frame_id, "
                "ai_label, ai_top_k, use_as_reference, previous, labelled_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (survey_id, track_id, action, species, invertebrate_type, box_source, frame_id, ai_label, ai_top_k,
                 int(use_as_reference), json.dumps(previous), by)).lastrowid
            self.conn.executemany("UPDATE detections SET species_id = ?, verified = 1, edited_by = ? WHERE id = ?",
                                  [(mirror_species_id, by, r["id"]) for r in rows])
        return label_id

    def undo_label(self, label_id: int) -> int | None:
        """Undo a label: the pictures go back to what they said before. Returns the survey id."""
        r = self.one("SELECT * FROM labels WHERE id = ? AND undone = 0", label_id)
        if not r:
            return None
        with self.lock, self.conn:
            self.conn.execute("UPDATE labels SET undone = 1 WHERE id = ?", (label_id,))
            self.conn.executemany("UPDATE detections SET species_id = ?, verified = ?, edited_by = ? WHERE id = ?",
                                  [(sp, ver, by, did) for did, sp, ver, by in json.loads(r["previous"])])
            if r["box_source"] == "human_drawn":  # a box a person drew goes away with its label
                self.conn.execute("DELETE FROM detections WHERE track_id = ? AND box_source = 'human_drawn'",
                                  (r["track_id"],))
        return r["survey_id"]

    def add_drawn_box(self, frame_id: int, x: float, y: float, w: float, h: float, by: str) -> str:
        """A fish or invertebrate the AI missed, drawn by a person. Returns its new track id."""
        track_id = f"h{uuid.uuid4().hex[:10]}"
        self.run("INSERT INTO detections (frame_id, species_id, model_species_id, confidence, verified, x, y, w, h, "
                 "edited_by, track_id, ai_label, box_source) VALUES (?, 'unknown', 'unknown', 1.0, 1, ?, ?, ?, ?, ?, "
                 "?, '', 'human_drawn')", frame_id, x, y, w, h, by, track_id)
        return track_id

    def frame_row(self, frame_id: int):
        return self.one("SELECT * FROM frames WHERE id = ?", frame_id)

    def frame_detections(self, frame_id: int):
        return self.all("SELECT * FROM detections WHERE frame_id = ?", frame_id)
