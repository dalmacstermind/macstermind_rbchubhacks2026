"""Settings from config/protocol.yaml (protocol rules) and config/app.yaml (app settings).

Protocol values are settings, not constants (CLAUDE.md, hard constraint 6): every module gets
these objects passed in and never reads the YAML files itself.
"""
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


class ConfigError(ValueError):
    """A settings file is missing, unreadable, or has a value that makes no sense."""


@dataclass(frozen=True)
class WindowConfig:
    trim_start_s: float
    trim_end_s: float
    max_extra_settle_s: float
    length_s: float
    settle_threshold: float
    settle_scan_fps: float
    settle_hold_s: float


@dataclass(frozen=True)
class SubsampleConfig:
    interval_s: float
    unit_s: float
    context_s: float
    first_point_offset_s: float


@dataclass(frozen=True)
class RichnessConfig:
    scan_fps: float


@dataclass(frozen=True)
class ProtocolConfig:
    window: WindowConfig
    subsample: SubsampleConfig
    richness: RichnessConfig


@dataclass(frozen=True)
class FramesConfig:
    seek_preroll_s: float


@dataclass(frozen=True)
class ClipsConfig:
    ffmpeg_path: Path | None
    ffmpeg_codec: str
    opencv_fourcc: str


@dataclass(frozen=True)
class AppConfig:
    frames: FramesConfig
    clips: ClipsConfig


def default_config_dir() -> Path:
    """backend/config in development; the bundled config folder in the packaged fincount-api.exe."""
    if getattr(sys, "frozen", False):
        bundle = getattr(sys, "_MEIPASS", None)  # PyInstaller unpacks data files here
        return Path(bundle or Path(sys.executable).parent) / "config"
    return Path(__file__).resolve().parent.parent / "config"


def load_protocol_config(path: Path | None = None) -> ProtocolConfig:
    path = path or default_config_dir() / "protocol.yaml"
    data = _read(path)
    window, sub, rich = (_section(data, name, path) for name in ("window", "subsample", "richness"))
    cfg = ProtocolConfig(
        window=WindowConfig(
            trim_start_s=_num(window, "window.trim_start_s", path, minimum=0),
            trim_end_s=_num(window, "window.trim_end_s", path, minimum=0),
            max_extra_settle_s=_num(window, "window.max_extra_settle_s", path, minimum=0),
            length_s=_num(window, "window.length_s", path, minimum=0, strict=True),
            settle_threshold=_num(window, "window.settle_threshold", path, minimum=0, strict=True),
            settle_scan_fps=_num(window, "window.settle_scan_fps", path, minimum=0, strict=True),
            settle_hold_s=_num(window, "window.settle_hold_s", path, minimum=0),
        ),
        subsample=SubsampleConfig(
            interval_s=_num(sub, "subsample.interval_s", path, minimum=0, strict=True),
            unit_s=_num(sub, "subsample.unit_s", path, minimum=0, strict=True),
            context_s=_num(sub, "subsample.context_s", path, minimum=0),
            first_point_offset_s=_num(sub, "subsample.first_point_offset_s", path, minimum=0),
        ),
        richness=RichnessConfig(scan_fps=_num(rich, "richness.scan_fps", path, minimum=0, strict=True)),
    )
    if cfg.subsample.first_point_offset_s >= cfg.subsample.interval_s:
        raise ConfigError(f"{path.name}: subsample.first_point_offset_s must be less than subsample.interval_s.")
    return cfg


def load_app_config(path: Path | None = None) -> AppConfig:
    path = path or default_config_dir() / "app.yaml"
    data = _read(path)
    frames, clips = _section(data, "frames", path), _section(data, "clips", path)
    ffmpeg = clips.get("ffmpeg_path")
    ffmpeg_path = None
    if ffmpeg:
        ffmpeg_path = Path(ffmpeg)
        if not ffmpeg_path.is_absolute():
            ffmpeg_path = path.parent / ffmpeg_path  # relative paths are relative to the config folder
    return AppConfig(
        frames=FramesConfig(seek_preroll_s=_num(frames, "frames.seek_preroll_s", path, minimum=0)),
        clips=ClipsConfig(
            ffmpeg_path=ffmpeg_path,
            ffmpeg_codec=_text(clips, "clips.ffmpeg_codec", path),
            opencv_fourcc=_fourcc(clips, path),
        ),
    )


def _read(path: Path) -> dict[str, Any]:
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ConfigError(f"Settings file not found: {path}") from None
    except yaml.YAMLError as e:
        raise ConfigError(f"Settings file {path.name} can't be read: {e}") from None
    if not isinstance(data, dict):
        raise ConfigError(f"Settings file {path.name} is empty or not a list of settings.")
    return data


def _section(data: dict[str, Any], name: str, path: Path) -> dict[str, Any]:
    section = data.get(name)
    if not isinstance(section, dict):
        raise ConfigError(f"{path.name}: the '{name}' section is missing.")
    return section


def _num(section: dict[str, Any], key: str, path: Path, *, minimum: float, strict: bool = False) -> float:
    value = section.get(key.split(".")[-1])
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ConfigError(f"{path.name}: {key} must be a number (got {value!r}).")
    if value < minimum or (strict and value == minimum):
        raise ConfigError(f"{path.name}: {key} must be {'more than' if strict else 'at least'} {minimum} (got {value}).")
    return float(value)


def _text(section: dict[str, Any], key: str, path: Path) -> str:
    value = section.get(key.split(".")[-1])
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"{path.name}: {key} must be set.")
    return value.strip()


def _fourcc(section: dict[str, Any], path: Path) -> str:
    value = _text(section, "clips.opencv_fourcc", path)
    if len(value) != 4:
        raise ConfigError(f"{path.name}: clips.opencv_fourcc must be 4 characters, e.g. mp4v (got {value!r}).")
    return value
