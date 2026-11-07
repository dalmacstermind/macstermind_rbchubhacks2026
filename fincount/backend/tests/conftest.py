from pathlib import Path

import pytest

from video_fixture import make_video


@pytest.fixture(scope="session")
def synthetic_video(tmp_path_factory) -> Path:
    """3 minutes at 10 fps (1800 frames), built once per test run in a temp folder."""
    return make_video(tmp_path_factory.mktemp("media") / "T1_STAT1_GX010021.mp4", seconds=180, fps=10)
