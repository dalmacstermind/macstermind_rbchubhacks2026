from pathlib import Path

import pytest

from video_fixture import make_video


@pytest.fixture(scope="session")
def synthetic_video(tmp_path_factory) -> Path:
    """3 minutes at 10 fps (1800 frames), built once per test run in a temp folder."""
    return make_video(tmp_path_factory.mktemp("media") / "T1_STAT1_GX010021.mp4", seconds=180, fps=10)


@pytest.fixture(autouse=True)
def demo_vision(tmp_path_factory):
    """By default tests run in demo mode (no model files), whatever is installed in backend/models.
    Tests of the real pipeline swap in test models with pipeline.set_vision()."""
    from dataclasses import replace

    from aquavision.config import load_vision_config
    from fincount_api import pipeline

    cfg = load_vision_config()
    empty = tmp_path_factory.mktemp("no-models")
    cfg = replace(cfg, models_dir=empty, detect=replace(cfg.detect, checkpoint=empty / "none.pth"),
                  species=replace(cfg.species, model_dir=empty / "none"))
    previous = pipeline.VISION
    pipeline.set_vision(pipeline.Vision(cfg))
    yield
    pipeline.set_vision(previous)
