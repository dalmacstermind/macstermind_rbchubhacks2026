"""Local database: one SQLite file in the app's data folder (on Windows: %APPDATA%\\FinCount\\fincount.db)."""
import json
import random
import re
import sqlite3
import threading
import time
from pathlib import Path

from aquavision.protocol import WindowProposal

from .schemas import (Box, Detection, Person, QcCount, QcCountIn, Species, SpeciesIn, SpeciesPatch, SurveyInfo,
                      Video)

# (id, common, scientific, status, habitat, kind). The real list comes from Coastal Action.
DEFAULT_SPECIES = [
    ("cod", "Atlantic cod", "Gadus morhua", "native", "Marine", "fish"),
    ("cunner", "Cunner", "Tautogolabrus adspersus", "native", "Marine", "fish"),
    ("mackerel", "Atlantic mackerel", "Scomber scombrus", "native", "Marine", "fish"),
    ("flounder", "Winter flounder", "Pseudopleuronectes americanus", "native", "Marine", "fish"),
    ("trout", "Brook trout", "Salvelinus fontinalis", "native", "Freshwater", "fish"),
    ("bass", "Smallmouth bass", "Micropterus dolomieu", "invasive", "Freshwater", "fish"),
    ("pickerel", "Chain pickerel", "Esox niger", "invasive", "Freshwater", "fish"),
    ("triggerfish", "Grey triggerfish", "Balistes capriscus", "unusual", "Marine", "fish"),
    ("green_crab", "European green crab", "Carcinus maenas", "invasive", "Marine", "invertebrate"),
    ("unknown", "Unidentified fish", "—", "native", "—", "fish"),
]

SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS species (
  id TEXT PRIMARY KEY, common TEXT NOT NULL, scientific TEXT NOT NULL,
  status TEXT NOT NULL, habitat TEXT NOT NULL, custom INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS surveys (
  id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, environment TEXT NOT NULL,
  threshold REAL NOT NULL, files TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS frames (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  source TEXT NOT NULL, timestamp TEXT NOT NULL, image_path TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS detections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  frame_id INTEGER NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
  species_id TEXT NOT NULL, model_species_id TEXT NOT NULL, confidence REAL NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0, x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS people (
  name TEXT PRIMARY KEY COLLATE NOCASE, role TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS qc_sample (
  survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  frame_id INTEGER NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, PRIMARY KEY (survey_id, frame_id)
);
CREATE TABLE IF NOT EXISTS qc_counts (
  frame_id INTEGER NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
  person TEXT NOT NULL, fish INTEGER NOT NULL, invertebrates INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (frame_id, person)
);
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id INTEGER NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL, path TEXT NOT NULL, duration_s REAL NOT NULL, fps REAL NOT NULL,
  -- what the app proposed; never changed after it's written
  proposed_start_s REAL, proposed_end_s REAL, proposed_reason TEXT NOT NULL,
  settled INTEGER, too_short INTEGER NOT NULL DEFAULT 0, settle_score REAL,
  -- what a person confirmed; empty until then
  window_start_s REAL, window_end_s REAL,
  confirmed_by TEXT NOT NULL DEFAULT '', confirmed_at TEXT NOT NULL DEFAULT ''
);
"""

# Columns added after the first version. Existing databases get them on start-up.
MIGRATIONS = [
    ("species", "kind", "TEXT NOT NULL DEFAULT 'fish'"),
    ("species", "added_by", "TEXT NOT NULL DEFAULT ''"),
    ("species", "added_at", "TEXT NOT NULL DEFAULT ''"),
    ("surveys", "survey_date", "TEXT NOT NULL DEFAULT ''"),
    ("surveys", "created_by", "TEXT NOT NULL DEFAULT ''"),
    ("frames", "clarity", "REAL"),
    ("detections", "edited_by", "TEXT NOT NULL DEFAULT ''"),
]


def _norm(name: str) -> str:
    return re.sub(r"\s+", "", name).lower()


class Database:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.Lock()  # the analysis runs in a background thread
        with self.lock:
            self.conn.executescript(SCHEMA)
            for table, column, decl in MIGRATIONS:
                cols = {r["name"] for r in self.conn.execute(f"PRAGMA table_info({table})")}
                if column not in cols:
                    self.conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
            self.conn.commit()
        if self.one("SELECT COUNT(*) AS n FROM species")["n"] == 0:
            self.reset_species()
        elif not self.one("SELECT 1 FROM species WHERE id = 'green_crab'"):
            # Older databases: add the invertebrate example once.
            self.run("INSERT OR IGNORE INTO species (id, common, scientific, status, habitat, kind, custom, sort) "
                     "VALUES ('green_crab', 'European green crab', 'Carcinus maenas', 'invasive', 'Marine', "
                     "'invertebrate', 0, 8)")

    def all(self, sql: str, *args):
        with self.lock:
            return self.conn.execute(sql, args).fetchall()

    def one(self, sql: str, *args):
        with self.lock:
            return self.conn.execute(sql, args).fetchone()

    def run(self, sql: str, *args) -> int:
        with self.lock, self.conn:
            return self.conn.execute(sql, args).lastrowid or 0

    # ── People ──

    def list_people(self) -> list[Person]:
        return [Person(name=r["name"], role=r["role"]) for r in self.all("SELECT * FROM people ORDER BY name")]

    def add_person(self, p: Person):
        self.run("INSERT INTO people (name, role) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET role = excluded.role",
                 p.name.strip(), p.role.strip())

    def remove_person(self, name: str):
        self.run("DELETE FROM people WHERE name = ?", name)

    def person_exists(self, name: str) -> bool:
        return self.one("SELECT 1 FROM people WHERE name = ?", name.strip()) is not None

    # ── Species ──

    def list_species(self) -> list[Species]:
        rows = self.all("SELECT * FROM species ORDER BY kind = 'invertebrate', sort, common")
        return [
            Species(id=r["id"], common=r["common"], scientific=r["scientific"], status=r["status"],
                    habitat=r["habitat"], kind=r["kind"], custom=bool(r["custom"]), added_by=r["added_by"],
                    added_at=r["added_at"])
            for r in rows
        ]

    def add_species(self, s: SpeciesIn):
        """Raises ValueError for a duplicate name (ignoring case and spaces)."""
        if any(_norm(x.common) == _norm(s.common) for x in self.list_species()):
            raise ValueError(f"“{s.common.strip()}” is already in the species list.")
        m = self.one("SELECT COALESCE(MAX(sort), 0) AS m FROM species")["m"]
        self.run("INSERT INTO species (id, common, scientific, status, habitat, kind, custom, sort, added_by, added_at) "
                 "VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, datetime('now','localtime'))",
                 f"custom-{int(time.time() * 1000)}", s.common.strip(), s.scientific.strip() or "—", s.status,
                 s.habitat, s.kind, m + 1, s.added_by)

    def update_species(self, species_id: str, patch: SpeciesPatch) -> bool:
        cur = next((s for s in self.list_species() if s.id == species_id), None)
        if not cur:
            return False
        nxt = cur.model_copy(update=patch.model_dump(exclude_none=True))
        self.run("UPDATE species SET common=?, scientific=?, status=?, habitat=?, kind=? WHERE id=?",
                 nxt.common, nxt.scientific, nxt.status, nxt.habitat, nxt.kind, species_id)
        return True

    def remove_species(self, species_id: str):
        self.run("DELETE FROM species WHERE id = ? AND custom = 1", species_id)

    def reset_species(self):
        with self.lock, self.conn:
            self.conn.execute("DELETE FROM species")
            self.conn.executemany(
                "INSERT INTO species (id, common, scientific, status, habitat, kind, custom, sort) "
                "VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
                [(*s, i) for i, s in enumerate(DEFAULT_SPECIES)])

    # ── Surveys ──

    _SURVEY = "SELECT s.*, (SELECT COUNT(*) FROM frames f WHERE f.survey_id = s.id) AS frame_count FROM surveys s"

    @staticmethod
    def _info(r) -> SurveyInfo:
        return SurveyInfo(id=r["id"], site=r["site"], environment=r["environment"], threshold=r["threshold"],
                          created_at=r["created_at"], survey_date=r["survey_date"], created_by=r["created_by"],
                          files=json.loads(r["files"]), frame_count=r["frame_count"], status=r["status"])

    def create_survey(self, site: str, environment: str, threshold: float, files: list[str],
                      survey_date: str = "", created_by: str = "") -> int:
        return self.run("INSERT INTO surveys (site, environment, threshold, files, status, survey_date, created_by) "
                        "VALUES (?, ?, ?, ?, 'running', ?, ?)",
                        site, environment, threshold, json.dumps(files), survey_date, created_by)

    def update_survey(self, survey_id: int, site: str | None, survey_date: str | None) -> bool:
        if not self.one("SELECT 1 FROM surveys WHERE id = ?", survey_id):
            return False
        if site is not None and site.strip():
            self.run("UPDATE surveys SET site = ? WHERE id = ?", site.strip(), survey_id)
        if survey_date is not None:
            self.run("UPDATE surveys SET survey_date = ? WHERE id = ?", survey_date, survey_id)
        return True

    def set_survey_status(self, survey_id: int, status: str):
        self.run("UPDATE surveys SET status = ? WHERE id = ?", status, survey_id)

    def list_surveys(self) -> list[SurveyInfo]:
        return [self._info(r) for r in self.all(f"{self._SURVEY} WHERE s.status = 'done' ORDER BY s.id DESC")]

    def get_survey(self, survey_id: int):
        r = self.one(f"{self._SURVEY} WHERE s.id = ?", survey_id)
        if not r:
            return None
        frames = self.all("SELECT * FROM frames WHERE survey_id = ? ORDER BY id", survey_id)
        dets = self.all("SELECT d.* FROM detections d JOIN frames f ON f.id = d.frame_id "
                        "WHERE f.survey_id = ? ORDER BY d.id", survey_id)
        by_frame: dict[int, list[Detection]] = {}
        for d in dets:
            by_frame.setdefault(d["frame_id"], []).append(Detection(
                id=str(d["id"]), species_id=d["species_id"], model_species_id=d["model_species_id"],
                confidence=d["confidence"], verified=bool(d["verified"]), edited_by=d["edited_by"],
                box=Box(x=d["x"], y=d["y"], w=d["w"], h=d["h"])))
        return self._info(r), [(f, by_frame.get(f["id"], [])) for f in frames]

    def delete_survey(self, survey_id: int):
        self.run("DELETE FROM surveys WHERE id = ?", survey_id)

    # ── Frames & detections ──

    def add_frame(self, survey_id: int, source: str, timestamp: str, image_path: str,
                  detections: list[tuple[str, float, Box]], clarity: float | None = None):
        """detections: (species_id, confidence, box) as the model produced them."""
        with self.lock, self.conn:
            frame_id = self.conn.execute(
                "INSERT INTO frames (survey_id, source, timestamp, image_path, clarity) VALUES (?, ?, ?, ?, ?)",
                (survey_id, source, timestamp, image_path, clarity)).lastrowid
            self.conn.executemany(
                "INSERT INTO detections (frame_id, species_id, model_species_id, confidence, x, y, w, h) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [(frame_id, sp, sp, conf, b.x, b.y, b.w, b.h) for sp, conf, b in detections])

    # ── Videos & analysis windows ──

    def add_video(self, survey_id: int, file_name: str, path: str, duration_s: float, fps: float,
                  proposal: WindowProposal) -> int:
        return self.run(
            "INSERT INTO videos (survey_id, file_name, path, duration_s, fps, proposed_start_s, proposed_end_s, "
            "proposed_reason, settled, too_short, settle_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            survey_id, file_name, path, duration_s, fps, proposal.start_s, proposal.end_s, proposal.reason,
            None if proposal.settled is None else int(proposal.settled), int(proposal.too_short),
            proposal.settle_score)

    @staticmethod
    def _video(r) -> Video:
        return Video(id=str(r["id"]), survey_id=r["survey_id"], file_name=r["file_name"],
                     duration_s=r["duration_s"], fps=r["fps"], proposed_start_s=r["proposed_start_s"],
                     proposed_end_s=r["proposed_end_s"], proposed_reason=r["proposed_reason"],
                     settled=None if r["settled"] is None else bool(r["settled"]), too_short=bool(r["too_short"]),
                     settle_score=r["settle_score"], window_start_s=r["window_start_s"],
                     window_end_s=r["window_end_s"], confirmed_by=r["confirmed_by"], confirmed_at=r["confirmed_at"])

    def list_videos(self, survey_id: int) -> list[Video] | None:
        if not self.one("SELECT 1 FROM surveys WHERE id = ?", survey_id):
            return None
        return [self._video(r) for r in self.all("SELECT * FROM videos WHERE survey_id = ? ORDER BY id", survey_id)]

    def get_video(self, video_id: int) -> Video | None:
        r = self.one("SELECT * FROM videos WHERE id = ?", video_id)
        return self._video(r) if r else None

    def confirm_window(self, video_id: int, start_s: float, end_s: float, by: str) -> Video | None:
        """Save the window a person confirmed (or re-confirmed). The original proposal is kept."""
        self.run("UPDATE videos SET window_start_s = ?, window_end_s = ?, confirmed_by = ?, "
                 "confirmed_at = datetime('now','localtime') WHERE id = ?",
                 round(start_s, 3), round(end_s, 3), by, video_id)
        return self.get_video(video_id)

    def frame_image(self, frame_id: int):
        r = self.one("SELECT image_path FROM frames WHERE id = ?", frame_id)
        return Path(r["image_path"]) if r else None

    def update_detection(self, detection_id: int, species_id: str, verified: bool, by: str) -> bool:
        with self.lock, self.conn:
            return self.conn.execute("UPDATE detections SET species_id = ?, verified = ?, edited_by = ? WHERE id = ?",
                                     (species_id, int(verified), by if verified else "", detection_id)).rowcount > 0

    # ── Blind QC ──

    def qc(self, survey_id: int, percent: float) -> tuple[list[str], list[QcCount]]:
        """The random QC sample (picked once, then kept) and the counts made so far."""
        sample = [str(r["frame_id"]) for r in self.all(
            "SELECT frame_id FROM qc_sample WHERE survey_id = ? ORDER BY position", survey_id)]
        if not sample:
            ids = [r["id"] for r in self.all("SELECT id FROM frames WHERE survey_id = ? ORDER BY id", survey_id)]
            if ids:
                n = max(1, round(len(ids) * percent / 100))
                picked = random.Random(survey_id).sample(ids, min(n, len(ids)))
                with self.lock, self.conn:
                    self.conn.executemany("INSERT INTO qc_sample VALUES (?, ?, ?)",
                                          [(survey_id, f, i) for i, f in enumerate(picked)])
                sample = [str(f) for f in picked]
        counts = [QcCount(frame_id=str(r["frame_id"]), person=r["person"], fish=r["fish"],
                          invertebrates=r["invertebrates"], created_at=r["created_at"])
                  for r in self.all("SELECT c.* FROM qc_counts c JOIN qc_sample s ON s.frame_id = c.frame_id "
                                    "WHERE s.survey_id = ? ORDER BY c.created_at", survey_id)]
        return sample, counts

    def add_qc_count(self, survey_id: int, c: QcCountIn) -> bool:
        if not self.one("SELECT 1 FROM qc_sample WHERE survey_id = ? AND frame_id = ?", survey_id, int(c.frame_id)):
            return False
        self.run("INSERT INTO qc_counts (frame_id, person, fish, invertebrates) VALUES (?, ?, ?, ?) "
                 "ON CONFLICT(frame_id, person) DO UPDATE SET fish = excluded.fish, "
                 "invertebrates = excluded.invertebrates, created_at = datetime('now','localtime')",
                 int(c.frame_id), c.person, c.fish, c.invertebrates)
        return True
