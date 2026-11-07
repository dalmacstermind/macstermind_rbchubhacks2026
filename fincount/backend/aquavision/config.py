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
class CountConfig:
    tolerance_s: float
    max_tolerance_s: float

    @property
    def effective_tolerance_s(self) -> float:
        """Protocol rule: ±tolerance_s around the point, never more than ±max_tolerance_s."""
        return min(self.tolerance_s, self.max_tolerance_s)


@dataclass(frozen=True)
class QcConfig:
    sample_fraction: float
    max_pct_diff: float
    min_agreement: float


@dataclass(frozen=True)
class ProtocolConfig:
    window: WindowConfig
    subsample: SubsampleConfig
    richness: RichnessConfig
    count: CountConfig
    qc: QcConfig
    visibility_categories: tuple[str, ...]


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
    window, sub, rich, count, qc, vis = (_section(data, name, path) for name in
                                         ("window", "subsample", "richness", "count", "qc", "visibility"))
    cats = vis.get("categories")
    if not isinstance(cats, list) or len(cats) < 2 or not all(isinstance(c, str) and c.strip() for c in cats):
        raise ConfigError(f"{path.name}: visibility.categories must be a list of at least two names.")
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
        count=CountConfig(tolerance_s=_num(count, "count.tolerance_s", path, minimum=0),
                          max_tolerance_s=_num(count, "count.max_tolerance_s", path, minimum=0)),
        qc=QcConfig(sample_fraction=_num(qc, "qc.sample_fraction", path, minimum=0, strict=True),
                    max_pct_diff=_num(qc, "qc.max_pct_diff", path, minimum=0),
                    min_agreement=_num(qc, "qc.min_agreement", path, minimum=0)),
        visibility_categories=tuple(c.strip() for c in cats),
    )
    if cfg.qc.sample_fraction > 1 or cfg.qc.min_agreement > 1:
        raise ConfigError(f"{path.name}: qc.sample_fraction and qc.min_agreement are fractions (0–1).")
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


# ── Vision pipeline settings (models, detect, species, track, clarity sections of app.yaml) ──

@dataclass(frozen=True)
class DetectConfig:
    checkpoint: Path
    conf_threshold: float
    nms_iou: float
    min_box_px: float
    context_fps: float  # pictures per second read from each point's ±context_s range


@dataclass(frozen=True)
class SpeciesConfig:
    model_dir: Path
    match_threshold: float
    margin: float
    novelty_threshold: float
    top_k: int
    crop_padding: float
    min_crop_px: float


@dataclass(frozen=True)
class TrackConfig:
    enabled: bool
    lost_buffer_s: float
    match_iou: float
    activation_threshold: float


@dataclass(frozen=True)
class ClarityConfig:
    weights: dict[str, float]
    category_thresholds: tuple[float, ...]  # clarity index boundaries between visibility categories
    review_threshold: float  # below this, a point needs review ("low visibility")


@dataclass(frozen=True)
class LabelConfig:
    match_iou: float  # a drawn box overlapping an existing fish this much relabels it instead of adding one


@dataclass(frozen=True)
class VisionConfig:
    models_dir: Path
    detect: DetectConfig
    species: SpeciesConfig
    track: TrackConfig
    clarity: ClarityConfig
    label: LabelConfig


CLARITY_MEASURES = ("contrast", "sharpness", "haze", "colour", "particles")


def load_vision_config(path: Path | None = None) -> VisionConfig:
    """Model locations and thresholds for detection, species ID, tracking and the clarity index."""
    path = path or default_config_dir() / "app.yaml"
    data = _read(path)
    models, det, sp, trk, clar, lab = (_section(data, n, path)
                                       for n in ("models", "detect", "species", "track", "clarity", "label"))
    thresholds = clar.get("category_thresholds")
    if (not isinstance(thresholds, list) or not thresholds
            or not all(isinstance(t, (int, float)) and 0 <= t <= 100 for t in thresholds)
            or list(thresholds) != sorted(thresholds)):
        raise ConfigError(f"{path.name}: clarity.category_thresholds must be increasing numbers from 0 to 100.")
    models_dir = Path(_text(models, "models.dir", path))
    if not models_dir.is_absolute():
        models_dir = (path.parent / models_dir).resolve()
    weights = clar.get("weights")
    if not isinstance(weights, dict) or set(weights) != set(CLARITY_MEASURES):
        raise ConfigError(f"{path.name}: clarity.weights must list exactly {', '.join(CLARITY_MEASURES)}.")
    w = {k: _num(weights, f"clarity.weights.{k}", path, minimum=0) for k in CLARITY_MEASURES}
    if sum(w.values()) <= 0:
        raise ConfigError(f"{path.name}: clarity.weights must not all be 0.")
    enabled = trk.get("enabled")
    if not isinstance(enabled, bool):
        raise ConfigError(f"{path.name}: track.enabled must be true or false.")
    cfg = VisionConfig(
        models_dir=models_dir,
        detect=DetectConfig(
            checkpoint=models_dir / _text(det, "detect.checkpoint", path),
            conf_threshold=_num(det, "detect.conf_threshold", path, minimum=0),
            nms_iou=_num(det, "detect.nms_iou", path, minimum=0, strict=True),
            min_box_px=_num(det, "detect.min_box_px", path, minimum=0),
            context_fps=_num(det, "detect.context_fps", path, minimum=0, strict=True),
        ),
        species=SpeciesConfig(
            model_dir=models_dir / _text(sp, "species.model_dir", path),
            match_threshold=_num(sp, "species.match_threshold", path, minimum=0),
            margin=_num(sp, "species.margin", path, minimum=0),
            novelty_threshold=_num(sp, "species.novelty_threshold", path, minimum=0),
            top_k=int(_num(sp, "species.top_k", path, minimum=1)),
            crop_padding=_num(sp, "species.crop_padding", path, minimum=0),
            min_crop_px=_num(sp, "species.min_crop_px", path, minimum=1),
        ),
        track=TrackConfig(
            enabled=enabled,
            lost_buffer_s=_num(trk, "track.lost_buffer_s", path, minimum=0, strict=True),
            match_iou=_num(trk, "track.match_iou", path, minimum=0, strict=True),
            activation_threshold=_num(trk, "track.activation_threshold", path, minimum=0),
        ),
        clarity=ClarityConfig(weights=w, category_thresholds=tuple(float(t) for t in thresholds),
                              review_threshold=_num(clar, "clarity.review_threshold", path, minimum=0)),
        label=LabelConfig(match_iou=_num(lab, "label.match_iou", path, minimum=0, strict=True)),
    )
    for key, value in (("detect.conf_threshold", cfg.detect.conf_threshold), ("detect.nms_iou", cfg.detect.nms_iou),
                       ("species.match_threshold", cfg.species.match_threshold),
                       ("species.novelty_threshold", cfg.species.novelty_threshold),
                       ("track.match_iou", cfg.track.match_iou)):
        if value > 1:
            raise ConfigError(f"{path.name}: {key} must be between 0 and 1 (got {value}).")
    if cfg.species.novelty_threshold > cfg.species.match_threshold:
        raise ConfigError(f"{path.name}: species.novelty_threshold must not be above species.match_threshold.")
    return cfg
