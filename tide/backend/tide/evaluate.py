"""Measure the AI the way the protocol measures a human counter (CLAUDE.md, Data and evaluation rules).

Compares the AI's per-point fish counts with hand counts of the same points:
- per point: absolute difference and % difference (|AI − human| ÷ max(human, 1) × 100; always
  reported with the absolute difference, because 1 vs 2 fish is already 50 %)
- share of points within qc.max_pct_diff (6 %) — the QC pass rule
- MeanCount per video (AI vs human) and its difference
- zero-point agreement: both say "no fish" or both say "some fish"

Hand counts come from a CSV (e.g. Coastal Action's past spreadsheets exported to CSV) or from
points staff corrected in the app. Never evaluate on videos whose labels were used as reference
pictures (no data leakage), and report the numbers as measured: no invented accuracy.

    python -m tide.evaluate --results results.json --human hand_counts.csv

CSV columns (header row, any order; extra columns are ignored):
    video        the video's file name (with or without extension)
    point        point number (1, 2, …)
    total_fish   the hand count of fish at that point
    invertebrates (optional)
"""
from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

from .config import QcConfig, load_protocol_config


@dataclass
class HumanCount:
    video: str
    point_no: int
    total_fish: int
    invertebrates: int | None = None


@dataclass
class PointComparison:
    video: str
    point_no: int
    ai: int
    human: int
    abs_diff: int
    pct_diff: float
    within: bool  # pct_diff < qc.max_pct_diff


@dataclass
class VideoComparison:
    video: str
    points: int
    mean_count_ai: float
    mean_count_human: float
    mean_count_abs_diff: float
    mean_count_pct_diff: float
    share_within: float  # 0–1
    zero_agreement: float  # 0–1


@dataclass
class Evaluation:
    points_compared: int
    share_within: float | None  # 0–1, share of points with < max_pct_diff difference
    mean_abs_diff: float | None  # fish per point
    median_pct_diff: float | None
    zero_agreement: float | None
    meets_agreement: bool | None  # share_within ≥ qc.min_agreement
    max_pct_diff: float
    min_agreement: float
    videos: list[VideoComparison]
    points: list[PointComparison]
    unmatched_human: list[str]  # hand counts with no matching AI point (video, point)
    source: str  # where the hand counts came from


def pct_diff(ai: int, human: int) -> float:
    return 0.0 if ai == human else abs(ai - human) / max(human, 1) * 100


def _key(name: str) -> str:
    return Path(name.strip()).stem.lower()


def read_human_csv(path: Path) -> list[HumanCount]:
    """Hand counts from a CSV file. Raises ValueError with a plain-English message."""
    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError as e:
        raise ValueError(f"Can't read {path.name}: {e.strerror or e}") from None
    rows = list(csv.DictReader(text.splitlines()))
    if not rows:
        raise ValueError(f"{path.name} has no rows.")
    cols = {c.strip().lower(): c for c in rows[0].keys() if c}
    missing = [c for c in ("video", "point", "total_fish") if c not in cols]
    if missing:
        raise ValueError(f"{path.name} needs the columns video, point and total_fish (missing: {', '.join(missing)}).")
    out = []
    for i, r in enumerate(rows, 2):
        try:
            inv = r.get(cols["invertebrates"], "") if "invertebrates" in cols else ""
            out.append(HumanCount(r[cols["video"]].strip(), int(float(r[cols["point"]])),
                                  int(float(r[cols["total_fish"]])), int(float(inv)) if str(inv).strip() else None))
        except (TypeError, ValueError):
            raise ValueError(f"{path.name}, line {i}: point and total_fish must be numbers.") from None
    return out


def compare(ai: dict[tuple[str, int], int], human: list[HumanCount], qc: QcConfig, source: str) -> Evaluation:
    """ai: (video name, point number) → the AI's fish count at that point."""
    ai_by_key = {(_key(v), p): n for (v, p), n in ai.items()}
    names = {_key(v): v for v, _ in ai}
    points, unmatched = [], []
    for h in human:
        k = (_key(h.video), h.point_no)
        if k not in ai_by_key:
            unmatched.append(f"{h.video} point {h.point_no}")
            continue
        a = ai_by_key[k]
        d = pct_diff(a, h.total_fish)
        points.append(PointComparison(names[k[0]], h.point_no, a, h.total_fish, abs(a - h.total_fish), round(d, 1),
                                      d < qc.max_pct_diff))
    videos = []
    for v in sorted({p.video for p in points}):
        ps = [p for p in points if p.video == v]
        ma, mh = statistics.mean(p.ai for p in ps), statistics.mean(p.human for p in ps)
        videos.append(VideoComparison(v, len(ps), round(ma, 3), round(mh, 3), round(abs(ma - mh), 3),
                                      round(abs(ma - mh) / max(mh, 1) * 100, 1),
                                      round(sum(p.within for p in ps) / len(ps), 3),
                                      round(sum((p.ai == 0) == (p.human == 0) for p in ps) / len(ps), 3)))
    n = len(points)
    share = round(sum(p.within for p in points) / n, 3) if n else None
    return Evaluation(
        n, share, round(statistics.mean(p.abs_diff for p in points), 3) if n else None,
        round(statistics.median(p.pct_diff for p in points), 1) if n else None,
        round(sum((p.ai == 0) == (p.human == 0) for p in points) / n, 3) if n else None,
        (share >= qc.min_agreement) if share is not None else None, qc.max_pct_diff, qc.min_agreement, videos,
        points, unmatched, source)


def ai_counts_from_results(results: dict) -> dict[tuple[str, int], int]:
    """(video name, point) → AI fish count, from the JSON of GET /surveys/{id}/results."""
    return {(v["name"], p["pointNo"]): p["ai"]["totalFish"] for v in results["videos"] for p in v["points"]}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Compare AI point counts with hand counts.")
    ap.add_argument("--results", required=True, type=Path, help="JSON saved from GET /surveys/{id}/results")
    ap.add_argument("--human", required=True, type=Path, help="CSV of hand counts (video, point, total_fish)")
    a = ap.parse_args(argv)
    ev = compare(ai_counts_from_results(json.loads(a.results.read_text(encoding="utf-8"))),
                 read_human_csv(a.human), load_protocol_config().qc, a.human.name)
    json.dump(asdict(ev), sys.stdout, indent=1)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
