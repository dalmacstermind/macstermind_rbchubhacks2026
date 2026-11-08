"""Model status: "real models" only when the weights are on disk AND the packages to run them are
installed. With weights but no PyTorch (etc.), the app must stay in demo mode and say why."""
from dataclasses import replace

import pytest

from tide.config import load_vision_config
from tide_api import pipeline


@pytest.fixture()
def weights(tmp_path):
    """A vision config whose detector and species model files exist (empty stand-ins)."""
    cfg = load_vision_config()
    checkpoint = tmp_path / "cfd.pth"
    checkpoint.write_bytes(b"")
    species_dir = tmp_path / "bioclip-2"
    species_dir.mkdir()
    (species_dir / "open_clip_config.json").write_text("{}", encoding="utf-8")
    return replace(cfg, models_dir=tmp_path, detect=replace(cfg.detect, checkpoint=checkpoint),
                   species=replace(cfg.species, model_dir=species_dir))


def packages(monkeypatch, missing: set[str]):
    monkeypatch.setattr(pipeline, "_importable", lambda m: m not in missing)


def test_weights_without_packages_stay_in_demo_mode(weights, monkeypatch):
    packages(monkeypatch, {"torch", "rfdetr", "open_clip", "trackers", "supervision"})
    v = pipeline.Vision(weights)
    assert not v.installed and not v.species_installed
    s = v.status(0)
    assert s.demo is True and s.name == "Demo mode"
    assert "software that runs them isn't installed" in s.message
    assert "torch, rfdetr, supervision, trackers" in s.message
    assert "sample data" in s.message


def test_one_missing_package_is_enough_for_demo_mode(weights, monkeypatch):
    packages(monkeypatch, {"trackers"})
    v = pipeline.Vision(weights)
    assert v.missing_packages == ["trackers"] and not v.installed
    assert v.species_installed  # the species model doesn't need the tracker


def test_tracker_packages_not_needed_when_tracking_is_off(weights, monkeypatch):
    packages(monkeypatch, {"trackers", "supervision"})
    v = pipeline.Vision(replace(weights, track=replace(weights.track, enabled=False)))
    assert v.missing_packages == [] and v.installed


def test_weights_and_packages_mean_real_models(weights, monkeypatch):
    packages(monkeypatch, set())
    s = pipeline.Vision(weights).status(3)
    assert s.demo is False and s.name == "Community Fish Detector + BioCLIP 2" and s.references == 3


def test_no_weights_still_says_files_are_missing(weights, monkeypatch, tmp_path):
    packages(monkeypatch, set())
    cfg = replace(weights, detect=replace(weights.detect, checkpoint=tmp_path / "missing.pth"))
    s = pipeline.Vision(cfg).status(0)
    assert s.demo is True and "aren't in the models folder yet" in s.message


def test_a_swapped_in_test_detector_counts_as_installed(monkeypatch):
    packages(monkeypatch, {"torch", "rfdetr", "open_clip", "trackers", "supervision"})
    v = pipeline.Vision(load_vision_config(), detector=object(), encoder=object())
    assert v.installed and v.species_installed and v.missing_packages == []
