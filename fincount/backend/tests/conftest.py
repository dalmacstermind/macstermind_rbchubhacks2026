from pathlib import Path

import pytest

from video_fixture import make_video


@pytest.fixture(scope="session")
def synthetic_video(tmp_path_factory) -> Path:
    """3 minutes at 10 fps (1800 frames), built once per test run in a temp folder. Too short for the protocol."""
    return make_video(tmp_path_factory.mktemp("media") / "T1_STAT1_GX010021.mp4", seconds=180, fps=10)


# Analysis-window videos: 5 fps keeps them small. 22 min fits the latest allowed start
# (60 s + 240 s extra settling + 15 min + 60 s = 21 min); 18 min doesn't.
@pytest.fixture(scope="session")
def clear_video(tmp_path_factory) -> Path:
    return make_video(tmp_path_factory.mktemp("media") / "clear.mp4", seconds=22 * 60, fps=5)


@pytest.fixture(scope="session")
def sediment_2min_video(tmp_path_factory) -> Path:
    return make_video(tmp_path_factory.mktemp("media") / "sediment_2min.mp4", seconds=22 * 60, fps=5, sediment_s=120)


@pytest.fixture(scope="session")
def sediment_6min_video(tmp_path_factory) -> Path:
    return make_video(tmp_path_factory.mktemp("media") / "sediment_6min.mp4", seconds=22 * 60, fps=5, sediment_s=360)


@pytest.fixture(scope="session")
def short_sediment_video(tmp_path_factory) -> Path:
    """18 min with 2 min of sediment: long enough for the protocol, but not for a later start."""
    return make_video(tmp_path_factory.mktemp("media") / "short_sediment.mp4", seconds=18 * 60, fps=5,
                      sediment_s=120)
