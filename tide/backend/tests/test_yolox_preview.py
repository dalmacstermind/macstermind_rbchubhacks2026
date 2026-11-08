"""The YOLOX preview is opt-in and always labelled as a preview."""
from dataclasses import replace

import pytest

from tide.config import ConfigError, load_vision_config
from tide.detect import CfdDetector, YoloxPreviewDetector
from tide_api import pipeline


def test_default_detector_is_unchanged(monkeypatch):
    monkeypatch.delenv("TIDE_DETECTOR", raising=False)
    assert load_vision_config().detect.backend == "cfd"


def test_environment_variable_switches_detector(monkeypatch):
    monkeypatch.setenv("TIDE_DETECTOR", "yolox")
    assert load_vision_config().detect.backend == "yolox"


def test_unknown_detector_is_refused(monkeypatch):
    monkeypatch.setenv("TIDE_DETECTOR", "nope")
    with pytest.raises(ConfigError, match="cfd or yolox"):
        load_vision_config()


def preview(tmp_path, monkeypatch):
    monkeypatch.delenv("TIDE_DETECTOR", raising=False)
    monkeypatch.setattr(pipeline, "_importable", lambda m: True)
    weights = tmp_path / "yolox_m.pth"
    weights.write_bytes(b"x")
    cfg = load_vision_config()
    return replace(cfg, detect=replace(cfg.detect, backend="yolox", yolox_checkpoint=weights),
                   species=replace(cfg.species, model_dir=tmp_path / "none"))


def test_preview_never_looks_like_a_real_result(tmp_path, monkeypatch):
    s = pipeline.Vision(preview(tmp_path, monkeypatch)).status(0)
    assert not s.demo and "not trained on fish" in s.name and "not results" in s.message


def test_vision_builds_the_chosen_detector(tmp_path, monkeypatch):
    monkeypatch.setattr(YoloxPreviewDetector, "load", lambda self: self)
    assert isinstance(pipeline.Vision(preview(tmp_path, monkeypatch)).detector(), YoloxPreviewDetector)
    monkeypatch.setattr(CfdDetector, "load", lambda self: self)
    cfg = load_vision_config()
    assert type(pipeline.Vision(cfg).detector()) is CfdDetector


def test_missing_weights_fall_back_to_demo_mode(tmp_path, monkeypatch):
    cfg = preview(tmp_path, monkeypatch)
    cfg = replace(cfg, detect=replace(cfg.detect, yolox_checkpoint=tmp_path / "none.pth"))
    assert pipeline.Vision(cfg).status(0).demo
