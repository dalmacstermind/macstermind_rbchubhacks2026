import sys
from pathlib import Path

import pytest
import yaml

from tide.config import ConfigError, default_config_dir, load_app_config, load_protocol_config
from tide.protocol import subsample_timestamps


def write_protocol(tmp_path: Path, **changes) -> Path:
    """Copy the real protocol.yaml with some values changed, e.g. subsample={"interval_s": 30}."""
    data = yaml.safe_load((default_config_dir() / "protocol.yaml").read_text(encoding="utf-8"))
    for section, values in changes.items():
        data[section].update(values)
    path = tmp_path / "protocol.yaml"
    path.write_text(yaml.safe_dump(data), encoding="utf-8")
    return path


def test_defaults_match_the_protocol_table():
    cfg = load_protocol_config()
    assert (cfg.window.trim_start_s, cfg.window.trim_end_s, cfg.window.length_s) == (60, 60, 900)
    assert (cfg.subsample.interval_s, cfg.subsample.context_s, cfg.subsample.first_point_offset_s) == (60, 5, 0)
    assert cfg.richness.scan_fps == 2


def test_app_defaults():
    cfg = load_app_config()
    assert cfg.frames.seek_preroll_s == 1.0
    assert cfg.clips.ffmpeg_path.is_file()  # the FFmpeg inside imageio-ffmpeg
    assert cfg.clips.ffmpeg_codec == "libx264"
    assert cfg.clips.opencv_fourcc == "mp4v"


def test_changing_the_yaml_changes_the_points_without_code_changes(tmp_path):
    default = load_protocol_config().subsample
    changed = load_protocol_config(write_protocol(tmp_path, subsample={"interval_s": 30, "context_s": 10})).subsample
    assert (changed.interval_s, changed.context_s) == (30, 10)
    assert len(subsample_timestamps(60, 960, default)) == 15
    assert len(subsample_timestamps(60, 960, changed)) == 30


@pytest.mark.parametrize("section, key, value", [
    ("subsample", "interval_s", 0),
    ("subsample", "interval_s", -60),
    ("subsample", "context_s", -1),
    ("subsample", "interval_s", "sixty"),
    ("subsample", "first_point_offset_s", 60),  # must be less than the interval
    ("richness", "scan_fps", 0),
    ("window", "length_s", 0),
])
def test_rejects_values_that_make_no_sense(tmp_path, section, key, value):
    with pytest.raises(ConfigError, match=key if key != "first_point_offset_s" else "first_point_offset_s"):
        load_protocol_config(write_protocol(tmp_path, **{section: {key: value}}))


def test_missing_or_broken_file_gives_a_clear_error(tmp_path):
    with pytest.raises(ConfigError, match="not found"):
        load_protocol_config(tmp_path / "nope.yaml")
    bad = tmp_path / "protocol.yaml"
    bad.write_text("window: [unclosed", encoding="utf-8")
    with pytest.raises(ConfigError, match="can't be read"):
        load_protocol_config(bad)
    bad.write_text("window: {}\n", encoding="utf-8")
    with pytest.raises(ConfigError, match="subsample"):
        load_protocol_config(bad)


def test_relative_ffmpeg_path_is_relative_to_the_config_folder(tmp_path):
    (tmp_path / "app.yaml").write_text(
        "frames: {seek_preroll_s: 1}\nclips: {ffmpeg_path: bin/ffmpeg.exe, ffmpeg_codec: libx264, opencv_fourcc: mp4v}\n",
        encoding="utf-8")
    assert load_app_config(tmp_path / "app.yaml").clips.ffmpeg_path == tmp_path / "bin" / "ffmpeg.exe"


def test_bad_fourcc_is_rejected(tmp_path):
    (tmp_path / "app.yaml").write_text(
        "frames: {seek_preroll_s: 1}\nclips: {ffmpeg_path: null, ffmpeg_codec: libx264, opencv_fourcc: h264x}\n",
        encoding="utf-8")
    with pytest.raises(ConfigError, match="opencv_fourcc"):
        load_app_config(tmp_path / "app.yaml")


def test_config_folder_in_the_packaged_app(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    assert default_config_dir() == tmp_path / "config"


def test_config_folder_in_development():
    assert default_config_dir() == Path(__file__).resolve().parent.parent / "config"
