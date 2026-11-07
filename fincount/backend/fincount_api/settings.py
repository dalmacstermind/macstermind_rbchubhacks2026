"""Protocol settings staff can change on the Settings screen.

- Defaults: config/protocol.yaml, shipped with the app and never written by it.
- Staff changes: <data folder>/protocol.yaml, a full copy written by the app. It lives outside the
  app folder, so reinstalling or updating TIDE never overwrites what staff set.
- Every save or reset is recorded (who, when, old and new values) in the protocol_changes table.
- Each survey keeps a snapshot of the values it was processed with (surveys.protocol_json), so a
  change here applies to new processing only.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import replace
from functools import cache
from pathlib import Path
from typing import TYPE_CHECKING

import yaml

from aquavision.config import ConfigError, ProtocolConfig, load_protocol_config, parse_protocol, protocol_to_dict
from aquavision.protocol import subsample_timestamps

from .schemas import ProtocolSettings, ProtocolSettingsState

if TYPE_CHECKING:  # db.py imports this module, so only import Database for type hints
    from .db import Database

log = logging.getLogger(__name__)

# What staff see for each setting the Settings screen can change (protocol.yaml key -> field name and label).
FIELDS = {
    "window.trim_start_s": ("trimStartS", "Trim at the start"),
    "window.trim_end_s": ("trimEndS", "Trim at the end"),
    "window.max_extra_settle_s": ("maxExtraSettleS", "Extra settling time allowed"),
    "window.length_s": ("lengthS", "Analysis window"),
    "subsample.interval_s": ("intervalS", "Subsample interval"),
    "subsample.first_point_offset_s": ("firstPointOffsetS", "First point after the window start"),
    "subsample.context_s": ("contextS", "Context around each point"),
    "count.tolerance_s": ("toleranceS", "Count tolerance"),
    "qc.sample_fraction": ("qcSamplePct", "QC sample"),
    "qc.max_pct_diff": ("qcMaxDiffPct", "QC maximum difference"),
    "qc.min_agreement": ("qcAgreementPct", "QC agreement target"),
}
PCT_FIELDS = {"qc.sample_fraction", "qc.min_agreement"}  # stored as fractions, shown as percentages


class SettingsError(ValueError):
    """Settings that break a protocol rule. errors maps a field name (e.g. "intervalS") to a plain-English reason."""

    def __init__(self, errors: dict[str, str]):
        super().__init__(next(iter(errors.values())))
        self.errors = errors


def to_settings(cfg: ProtocolConfig) -> ProtocolSettings:
    """The values the Settings screen shows, in its units (seconds and percentages)."""
    w, sub, count, qc = cfg.window, cfg.subsample, cfg.count, cfg.qc
    return ProtocolSettings(
        trim_start_s=w.trim_start_s, trim_end_s=w.trim_end_s, max_extra_settle_s=w.max_extra_settle_s,
        length_s=w.length_s, interval_s=sub.interval_s, first_point_offset_s=sub.first_point_offset_s,
        context_s=sub.context_s, tolerance_s=count.tolerance_s, max_tolerance_s=count.max_tolerance_s,
        qc_sample_pct=round(qc.sample_fraction * 100, 4), qc_max_diff_pct=qc.max_pct_diff,
        qc_agreement_pct=round(qc.min_agreement * 100, 4), points_per_window=points_per_window(cfg))


@cache
def default_protocol() -> ProtocolConfig:
    """The shipped config/protocol.yaml."""
    return load_protocol_config()


def survey_protocol(db: Database, survey_id: int) -> ProtocolConfig:
    """The protocol values a survey was processed with. Surveys processed before these were recorded
    use the shipped defaults (the report says so: SurveyInfo.protocol is None)."""
    return db.survey_protocol(survey_id) or default_protocol()


def snapshot_config(protocol_json: str | None) -> ProtocolConfig | None:
    """A survey's saved snapshot, or None if it wasn't recorded (or can't be read)."""
    if not protocol_json:
        return None
    try:
        return parse_protocol(json.loads(protocol_json), "survey settings")
    except (ValueError, ConfigError):
        log.warning("A survey's saved protocol settings can't be read; using the defaults for it")
        return None


def points_per_window(cfg: ProtocolConfig) -> int:
    """How many subsample points one analysis window gets with these settings."""
    return len(subsample_timestamps(0, cfg.window.length_s, cfg.subsample))


def apply_settings(base: ProtocolConfig, s: ProtocolSettings) -> ProtocolConfig:
    """base with the screen's values swapped in, checked against every protocol rule.

    Settings the screen doesn't show (sediment check, scan rates, visibility categories, the ±1 s
    tolerance limit) keep their values from base. Raises SettingsError naming the field at fault.
    """
    w, sub, count, qc = base.window, base.subsample, base.count, base.qc
    candidate = replace(
        base,
        window=replace(w, trim_start_s=s.trim_start_s, trim_end_s=s.trim_end_s,
                       max_extra_settle_s=s.max_extra_settle_s, length_s=s.length_s),
        subsample=replace(sub, interval_s=s.interval_s, first_point_offset_s=s.first_point_offset_s,
                          context_s=s.context_s),
        count=replace(count, tolerance_s=s.tolerance_s),
        qc=replace(qc, sample_fraction=s.qc_sample_pct / 100, max_pct_diff=s.qc_max_diff_pct,
                   min_agreement=s.qc_agreement_pct / 100),
    )
    try:
        return parse_protocol(protocol_to_dict(candidate), "protocol settings")
    except ConfigError as e:
        raise SettingsError({_field(e.key): _plain(e)}) from None


def _field(key: str | None) -> str:
    return FIELDS[key][0] if key in FIELDS else "general"


def _plain(e: ConfigError) -> str:
    """'qc.sample_fraction must be a fraction up to 1 (got 1.5).' -> 'QC sample must be at most 100% (got 150%).'"""
    if e.key not in FIELDS or not e.reason:
        return str(e)
    label = FIELDS[e.key][1]
    if e.key in PCT_FIELDS:  # explain the percentage the person typed, not the stored fraction
        return {"qc.sample_fraction": f"{label} must be more than 0% and at most 100%.",
                "qc.min_agreement": f"{label} must be from 50% to 100%."}[e.key]
    return f"{label} {e.reason}"


class ProtocolSettingsStore:
    """The current protocol settings: the data-folder copy if staff saved one, otherwise the defaults."""

    def __init__(self, data_dir: Path, db: Database, defaults_path: Path | None = None):
        self.path = data_dir / "protocol.yaml"
        self.db = db
        self.defaults = load_protocol_config(defaults_path)  # a broken shipped file should stop start-up
        self.warning = ""
        self.current = self._load()

    def _load(self) -> ProtocolConfig:
        if not self.path.is_file():
            return self.defaults
        try:
            return load_protocol_config(self.path)
        except ConfigError as e:  # don't stop TIDE starting because of a damaged saved copy
            log.error("Saved protocol settings can't be used (%s); using the defaults", e)
            self.warning = (f"The saved protocol settings couldn't be read ({e}), so the defaults are in use. "
                            "Save the settings again to fix this.")
            return self.defaults

    def state(self) -> ProtocolSettingsState:
        last = self.db.last_protocol_change()
        custom = self.path.is_file() and not self.warning
        return ProtocolSettingsState(
            values=to_settings(self.current), defaults=to_settings(self.defaults),
            source="custom" if custom else "default", changed_by=last["changed_by"] if last else "",
            changed_at=last["changed_at"] if last else "", warning=self.warning)

    def save(self, s: ProtocolSettings, person: str) -> ProtocolConfig:
        new = apply_settings(self.current, s)
        self._write(new, person)
        self._record(new, person, "saved")
        self.current, self.warning = new, ""
        return new

    def reset(self, person: str) -> ProtocolConfig:
        self.path.unlink(missing_ok=True)
        self._record(self.defaults, person, "reset to defaults")
        self.current, self.warning = self.defaults, ""
        return self.defaults

    def _write(self, cfg: ProtocolConfig, person: str) -> None:
        """Write the whole file to a temporary name, then swap it in, so a crash never leaves half a file."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        header = ("# TIDE protocol settings, saved from the Settings screen by "
                  f"{person}. The shipped defaults are in the app's config/protocol.yaml.\n"
                  "# Delete this file (or use 'Reset to defaults') to go back to them.\n")
        tmp = self.path.with_suffix(".yaml.tmp")
        tmp.write_text(header + yaml.safe_dump(protocol_to_dict(cfg), sort_keys=False, allow_unicode=True),
                       encoding="utf-8")
        os.replace(tmp, self.path)

    def _record(self, new: ProtocolConfig, person: str, action: str) -> None:
        self.db.add_protocol_change(person, action, json.dumps(protocol_to_dict(self.current)),
                                    json.dumps(protocol_to_dict(new)))
