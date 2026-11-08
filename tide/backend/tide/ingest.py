"""Read Transect, STAT and recording date from a file's path (CLAUDE.md, Adding media).

Coastal Action's folders look like `Fall 2025/August 20_2025/T1/STAT 1/GX010021.MP4`, and file
names often carry Transect and STAT too (`...-T1-STAT2 411.MP4`). Dates come from folders only: a date in
a file name is often when a clip was saved or exported. Nothing is guessed: when a value can't be read,
it stays None and staff can fill it in.
"""
from __future__ import annotations

import re
from datetime import date
from pathlib import PurePath

_MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
     "november", "december"], 1)}
_TRANSECT = re.compile(r"(?:^|[^a-z0-9])(?:t|transect)\s*[-_ ]?\s*(\d{1,2})(?=$|[^0-9])", re.I)
_STAT = re.compile(r"(?:^|[^a-z0-9])stat(?:ion)?\s*[-_ ]?\s*(\d{1,3})(?=$|[^0-9])", re.I)
_ISO = re.compile(r"(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})")
_MONTH_DAY_YEAR = re.compile(r"([a-z]+)\s*[-_ ]?\s*(\d{1,2})\s*[-_, ]\s*(20\d{2})", re.I)


def transect_stat(path: str) -> tuple[str | None, str | None]:
    """("T1", "STAT 2") from the path's folders and file name, or None where it can't be read."""
    parts = PurePath(path.replace("\\", "/")).parts
    transect = stat = None
    for part in reversed(parts):  # the file name and its nearest folders win
        if transect is None and (m := _TRANSECT.search(part)):
            transect = f"T{int(m.group(1))}"
        if stat is None and (m := _STAT.search(part)):
            stat = f"STAT {int(m.group(1))}"
    return transect, stat


def date_in_text(text: str) -> date | None:
    """The first date written in `text` (`2025-08-20` or `August 20_2025`), or None."""
    if m := _ISO.search(text):
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass
    if (m := _MONTH_DAY_YEAR.search(text)) and m.group(1).lower() in _MONTHS:
        try:
            return date(int(m.group(3)), _MONTHS[m.group(1).lower()], int(m.group(2)))
        except ValueError:
            pass
    return None


def recorded_date(path: str) -> date | None:
    """The recording date from a folder like `August 20_2025` or `2025-08-20`; None if there is none.

    Never from the file name itself (see the module docstring).
    """
    for part in reversed(PurePath(path.replace("\\", "/")).parts[:-1]):
        if found := date_in_text(part):
            return found
    return None
