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
    """A settings file is missing, unreadable, or has a value that makes no sense.

    key and reason are set when one setting is at fault (e.g. "subsample.interval_s", "must be more than 0"),
    so the Settings screen can show the message next to that field in plain English.
    """

    def __init__(self, message: str, key: str | None = None, reason: str | None = None):
        super().__init__(message)
        self.key, self.reason = key, reason


def _bad(where: str, key: str, reason: str) -> ConfigError:
    return ConfigError(f"{where}: {key} {reason}", key, reason)


@dataclass(frozen=True)
class WindowConfig:
    trim_start_s: float
    trim_end_s: float
    max_extra_settle_s: float
    length_s: float
    settle_threshold: float
    settle_scan_fps: float
    settle_hold_s: float
    allow_short_videos: bool  # propose a shorter window for videos under trim + length + trim


@dataclass(frozen=True)
class SubsampleConfig:
    interval_s: float
    unit_s: float
    context_s: float
    first_point_offset_s: float
    short_window_interval_s: float  # point spacing in shorter windows (short videos only)


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
    """backend/config in development; the bundled config folder in the packaged tide-api.exe."""
    if getattr(sys, "frozen", False):
        bundle = getattr(sys, "_MEIPASS", None)  # PyInstaller unpacks data files here
        return Path(bundle or Path(sys.executable).parent) / "config"
    return Path(__file__).resolve().parent.parent / "config"


def load_protocol_config(path: Path | None = None) -> ProtocolConfig:
    path = path or default_config_dir() / "protocol.yaml"
    return parse_protocol(_read(path), path.name)


def parse_protocol(data: dict[str, Any], where: str) -> ProtocolConfig:
    """Check protocol settings from any source: a YAML file, saved settings, or a survey's snapshot.

    where names the source in error messages, e.g. "protocol.yaml".
    """
    path = where
    window, sub, rich, count, qc, vis = (_section(data, name, path) for name in
                                         ("window", "subsample", "richness", "count", "qc", "visibility"))
    cats = vis.get("categories")
    if not isinstance(cats, list) or len(cats) < 2 or not all(isinstance(c, str) and c.strip() for c in cats):
        raise _bad(where, "visibility.categories", "must be a list of at least two names.")
    cfg = ProtocolConfig(
        window=WindowConfig(
            trim_start_s=_num(window, "window.trim_start_s", path, minimum=0),
            trim_end_s=_num(window, "window.trim_end_s", path, minimum=0),
            max_extra_settle_s=_num(window, "window.max_extra_settle_s", path, minimum=0),
            length_s=_num(window, "window.length_s", path, minimum=0, strict=True),
            settle_threshold=_num(window, "window.settle_threshold", path, minimum=0, strict=True),
            settle_scan_fps=_num(window, "window.settle_scan_fps", path, minimum=0, strict=True),
            settle_hold_s=_num(window, "window.settle_hold_s", path, minimum=0),
            allow_short_videos=_bool({"allow_short_videos": True, **window}, "window.allow_short_videos", path),  # older saved settings: on
        ),
        subsample=SubsampleConfig(
            interval_s=_num(sub, "subsample.interval_s", path, minimum=0, strict=True),
            unit_s=_num(sub, "subsample.unit_s", path, minimum=0, strict=True),
            context_s=_num(sub, "subsample.context_s", path, minimum=0),
            first_point_offset_s=_num(sub, "subsample.first_point_offset_s", path, minimum=0),
            short_window_interval_s=_num({"short_window_interval_s": 2, **sub}, "subsample.short_window_interval_s", path,
                                         minimum=0, strict=True),  # older saved settings: 2 s
        ),
        richness=RichnessConfig(scan_fps=_num(rich, "richness.scan_fps", path, minimum=0, strict=True)),
        count=CountConfig(tolerance_s=_num(count, "count.tolerance_s", path, minimum=0),
                          max_tolerance_s=_num(count, "count.max_tolerance_s", path, minimum=0)),
        qc=QcConfig(sample_fraction=_num(qc, "qc.sample_fraction", path, minimum=0, strict=True),
                    max_pct_diff=_num(qc, "qc.max_pct_diff", path, minimum=0),
                    min_agreement=_num(qc, "qc.min_agreement", path, minimum=0)),
        visibility_categories=tuple(c.strip() for c in cats),
    )
    _check_protocol_rules(cfg, where)
    return cfg


def _check_protocol_rules(cfg: ProtocolConfig, where: str) -> None:
    """Rules that involve more than one setting, or a range a single number check can't express."""
    w, sub, count, qc = cfg.window, cfg.subsample, cfg.count, cfg.qc
    if qc.sample_fraction > 1:
        raise _bad(where, "qc.sample_fraction", f"must be a fraction up to 1 (got {qc.sample_fraction:g}).")
    if not 0.5 <= qc.min_agreement <= 1:
        raise _bad(where, "qc.min_agreement", f"must be a fraction from 0.5 to 1 (got {qc.min_agreement:g}).")
    if qc.max_pct_diff > 100:
        raise _bad(where, "qc.max_pct_diff", f"must be a percentage from 0 to 100 (got {qc.max_pct_diff:g}).")
    if count.tolerance_s > count.max_tolerance_s:
        raise _bad(where, "count.tolerance_s", f"must not be more than the protocol's limit of "
                                               f"±{count.max_tolerance_s:g} s (got {count.tolerance_s:g}).")
    if sub.context_s < count.tolerance_s:
        raise _bad(where, "subsample.context_s", f"must be at least the count tolerance (±{count.tolerance_s:g} s) "
                                                 f"so the context covers it (got {sub.context_s:g}).")
    if sub.interval_s > w.length_s:
        raise _bad(where, "subsample.interval_s", f"must not be longer than the analysis window "
                                                  f"({w.length_s:g} s) (got {sub.interval_s:g}).")
    if sub.first_point_offset_s >= sub.interval_s:
        raise _bad(where, "subsample.first_point_offset_s", f"must be less than the subsample interval "
                                                            f"({sub.interval_s:g} s) (got {sub.first_point_offset_s:g}).")


def protocol_to_dict(cfg: ProtocolConfig) -> dict[str, Any]:
    """The same layout as protocol.yaml: used to save settings and each survey's snapshot."""
    w, sub, count, qc = cfg.window, cfg.subsample, cfg.count, cfg.qc
    return {
        "window": {"trim_start_s": w.trim_start_s, "trim_end_s": w.trim_end_s,
                   "max_extra_settle_s": w.max_extra_settle_s, "length_s": w.length_s,
                   "settle_threshold": w.settle_threshold, "settle_scan_fps": w.settle_scan_fps,
                   "settle_hold_s": w.settle_hold_s, "allow_short_videos": w.allow_short_videos},
        "subsample": {"interval_s": sub.interval_s, "unit_s": sub.unit_s, "context_s": sub.context_s,
                      "first_point_offset_s": sub.first_point_offset_s,
                      "short_window_interval_s": sub.short_window_interval_s},
        "count": {"tolerance_s": count.tolerance_s, "max_tolerance_s": count.max_tolerance_s},
        "richness": {"scan_fps": cfg.richness.scan_fps},
        "qc": {"sample_fraction": qc.sample_fraction, "max_pct_diff": qc.max_pct_diff,
               "min_agreement": qc.min_agreement},
        "visibility": {"categories": list(cfg.visibility_categories)},
    }


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


def _name(where: Path | str) -> str:
    return where if isinstance(where, str) else where.name


def _section(data: dict[str, Any], name: str, path: Path | str) -> dict[str, Any]:
    section = data.get(name)
    if not isinstance(section, dict):
        raise ConfigError(f"{_name(path)}: the '{name}' section is missing.", name, "is missing.")
    return section


def _num(section: dict[str, Any], key: str, path: Path | str, *, minimum: float, strict: bool = False) -> float:
    value = section.get(key.split(".")[-1])
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value:  # value != value: NaN
        raise _bad(_name(path), key, f"must be a number (got {value!r}).")
    if value < minimum or (strict and value == minimum):
        raise _bad(_name(path), key, f"must be {'more than' if strict else 'at least'} {minimum:g} (got {value:g}).")
    return float(value)


def _choice(section: dict[str, Any], key: str, path: Path | str, options: tuple[str, ...]) -> str:
    value = section.get(key.split(".")[-1])
    if value not in options:
        raise _bad(_name(path), key, f"must be one of {', '.join(options)} (got {value!r}).")
    return value


def _bool(section: dict[str, Any], key: str, path: Path | str) -> bool:
    value = section.get(key.split(".")[-1])
    if not isinstance(value, bool):
        raise _bad(_name(path), key, f"must be true or false (got {value!r}).")
    return value


def _text(section: dict[str, Any], key: str, path: Path | str) -> str:
    value = section.get(key.split(".")[-1])
    if not isinstance(value, str) or not value.strip():
        raise _bad(_name(path), key, "must be set.")
    return value.strip()


def _fourcc(section: dict[str, Any], path: Path | str) -> str:
    value = _text(section, "clips.opencv_fourcc", path)
    if len(value) != 4:
        raise _bad(_name(path), "clips.opencv_fourcc", f"must be 4 characters, e.g. mp4v (got {value!r}).")
    return value


# ── Vision pipeline settings (models, detect, species, track, clarity sections of app.yaml) ──

@dataclass(frozen=True)
class DetectConfig:
    checkpoint: Path
    conf_threshold: float
    nms_iou: float
    min_box_px: float
    context_fps: float  # pictures per second read from each point's ±context_s range
    speck_max_area_pct: float  # "ignore tiny specks": boxes under this % of the picture are dropped
    look_closer_grid: int  # "look closer for small fish": tiles per side on the full-resolution picture


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
    tracker: str  # "bytetrack" | "ocsort"


@dataclass(frozen=True)
class ClarityConfig:
    weights: dict[str, float]
    category_thresholds: tuple[float, ...]  # clarity index boundaries between visibility categories
    review_threshold: float  # below this, a point needs review ("low visibility")


@dataclass(frozen=True)
class QualityConfig:
    analysis_width: int
    clear_min_score: float
    moderate_min_score: float
    muddy_min_score: float
    blur_threshold: float
    min_contrast: float


@dataclass(frozen=True)
class StaticFilterConfig:
    enabled: bool
    conservative: bool
    static_diff_threshold: float
    local_change_fraction: float
    ssim_threshold: float
    periodic_interval_s: float
    comparison_width: int


@dataclass(frozen=True)
class DriftConfig:
    enabled: bool
    flag_threshold: float
    min_background_motion_px: float


@dataclass(frozen=True)
class MotionConfig:
    enabled: bool
    work_width: int
    threshold_sigma: float
    min_area_px: float
    max_area_px: float
    link_px: float
    min_frames: int
    min_travel_px: float
    confidence: float
    max_moving_fraction: float  # more than this share of the picture changing = the camera moved


@dataclass(frozen=True)
class StationaryConfig:
    min_sightings: int
    min_span_s: float
    max_shift_pct: float


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
    stationary: StationaryConfig
    motion: MotionConfig
    quality: QualityConfig
    static_filter: StaticFilterConfig
    drift: DriftConfig


CLARITY_MEASURES = ("contrast", "sharpness", "haze", "colour", "particles")


def load_vision_config(path: Path | None = None) -> VisionConfig:
    """Model locations and thresholds for detection, species ID, tracking and the clarity index."""
    path = path or default_config_dir() / "app.yaml"
    data = _read(path)
    models, det, sp, trk, clar, lab, stat, mot, qual, sf, dr = (
        _section(data, n, path) for n in ("models", "detect", "species", "track", "clarity", "label", "stationary",
                                          "motion", "quality", "static_filter", "drift"))
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
            speck_max_area_pct=_num(det, "detect.speck_max_area_pct", path, minimum=0),
            look_closer_grid=int(_num(det, "detect.look_closer_grid", path, minimum=1)),
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
            tracker=_choice(trk, "track.tracker", path, ("bytetrack", "ocsort")),
        ),
        clarity=ClarityConfig(weights=w, category_thresholds=tuple(float(t) for t in thresholds),
                              review_threshold=_num(clar, "clarity.review_threshold", path, minimum=0)),
        label=LabelConfig(match_iou=_num(lab, "label.match_iou", path, minimum=0, strict=True)),
        stationary=StationaryConfig(
            min_sightings=int(_num(stat, "stationary.min_sightings", path, minimum=2)),
            min_span_s=_num(stat, "stationary.min_span_s", path, minimum=0),
            max_shift_pct=_num(stat, "stationary.max_shift_pct", path, minimum=0),
        ),
        motion=MotionConfig(
            enabled=_bool(mot, "motion.enabled", path),
            work_width=int(_num(mot, "motion.work_width", path, minimum=160)),
            threshold_sigma=_num(mot, "motion.threshold_sigma", path, minimum=0, strict=True),
            min_area_px=_num(mot, "motion.min_area_px", path, minimum=1),
            max_area_px=_num(mot, "motion.max_area_px", path, minimum=1),
            link_px=_num(mot, "motion.link_px", path, minimum=0, strict=True),
            min_frames=int(_num(mot, "motion.min_frames", path, minimum=2)),
            min_travel_px=_num(mot, "motion.min_travel_px", path, minimum=0),
            confidence=_num(mot, "motion.confidence", path, minimum=0, strict=True),
            max_moving_fraction=_num(mot, "motion.max_moving_fraction", path, minimum=0, strict=True),
        ),
        quality=QualityConfig(
            analysis_width=int(_num(qual, "quality.analysis_width", path, minimum=64)),
            clear_min_score=_num(qual, "quality.clear_min_score", path, minimum=0),
            moderate_min_score=_num(qual, "quality.moderate_min_score", path, minimum=0),
            muddy_min_score=_num(qual, "quality.muddy_min_score", path, minimum=0),
            blur_threshold=_num(qual, "quality.blur_threshold", path, minimum=0),
            min_contrast=_num(qual, "quality.min_contrast", path, minimum=0),
        ),
        static_filter=StaticFilterConfig(
            enabled=_bool(sf, "static_filter.enabled", path),
            conservative=_bool(sf, "static_filter.conservative", path),
            static_diff_threshold=_num(sf, "static_filter.static_diff_threshold", path, minimum=0),
            local_change_fraction=_num(sf, "static_filter.local_change_fraction", path, minimum=0),
            ssim_threshold=_num(sf, "static_filter.ssim_threshold", path, minimum=0),
            periodic_interval_s=_num(sf, "static_filter.periodic_interval_s", path, minimum=0, strict=True),
            comparison_width=int(_num(sf, "static_filter.comparison_width", path, minimum=32)),
        ),
        drift=DriftConfig(
            enabled=_bool(dr, "drift.enabled", path),
            flag_threshold=_num(dr, "drift.flag_threshold", path, minimum=0),
            min_background_motion_px=_num(dr, "drift.min_background_motion_px", path, minimum=0),
        ),
    )
    q = cfg.quality
    if not q.clear_min_score >= q.moderate_min_score >= q.muddy_min_score:
        raise ConfigError(f"{path.name}: quality scores must go clear ≥ moderate ≥ muddy.")
    for key, value in (("detect.conf_threshold", cfg.detect.conf_threshold), ("detect.nms_iou", cfg.detect.nms_iou),
                       ("species.match_threshold", cfg.species.match_threshold),
                       ("species.novelty_threshold", cfg.species.novelty_threshold),
                       ("track.match_iou", cfg.track.match_iou)):
        if value > 1:
            raise ConfigError(f"{path.name}: {key} must be between 0 and 1 (got {value}).")
    if cfg.species.novelty_threshold > cfg.species.match_threshold:
        raise ConfigError(f"{path.name}: species.novelty_threshold must not be above species.match_threshold.")
    return cfg
