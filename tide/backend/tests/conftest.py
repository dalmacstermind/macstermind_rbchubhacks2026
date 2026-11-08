from pathlib import Path

import pytest

from video_fixture import make_video


@pytest.fixture(scope="session")
def synthetic_video(tmp_path_factory) -> Path:
    """3 minutes at 10 fps (1800 frames), built once per test run in a temp folder. Too short for the protocol."""
    return make_video(tmp_path_factory.mktemp("media") / "T1_STAT1_GX010021.mp4", seconds=180, fps=10)


@pytest.fixture(autouse=True)
def demo_vision(tmp_path_factory):
    """By default tests run in demo mode (no model files), whatever is installed in backend/models.
    Tests of the real pipeline swap in test models with pipeline.set_vision()."""
    from dataclasses import replace

    from tide.config import load_vision_config
    from tide_api import pipeline

    cfg = load_vision_config()
    empty = tmp_path_factory.mktemp("no-models")
    cfg = replace(cfg, models_dir=empty, detect=replace(cfg.detect, checkpoint=empty / "none.pth"),
                  species=replace(cfg.species, model_dir=empty / "none"))
    previous = pipeline.VISION
    pipeline.set_vision(pipeline.Vision(cfg))
    yield
    pipeline.set_vision(previous)
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


def use_short_protocol(main) -> None:
    """Point counting tests: a short protocol (trim 10 s, 60 s window, a point every 20 s) so a
    3-minute synthetic video is long enough. Applied to the reloaded API module and its job runner."""
    from dataclasses import replace
    p = main.protocol
    short = replace(p, window=replace(p.window, trim_start_s=10, trim_end_s=10, length_s=60, max_extra_settle_s=20),
                    subsample=replace(p.subsample, interval_s=20))
    main.protocol = short
    main.jobs.protocol = short


def confirm_and_count(client, survey_id: int, person: str = "Ana", start_s: float | None = None) -> dict:
    """Confirm each video's proposed window as `person`, wait for the point counting, return the results."""
    import time
    from urllib.parse import quote
    client.post("/people", json={"name": person})
    for v in client.get(f"/surveys/{survey_id}/videos").json():
        s = v["proposedStartS"] if start_s is None else start_s
        r = client.patch(f"/videos/{v['id']}", json={"windowStartS": s, "windowEndS": s + 60},
                         headers={"X-TIDE-User": quote(person)})
        assert r.status_code == 200, r.text
    for _ in range(3600):  # up to ~3 min: counting runs in the background
        res = client.get(f"/surveys/{survey_id}/results").json()
        if all(v["countState"] in ("done", "failed") for v in res["videos"]):
            return res
        time.sleep(0.05)
    raise AssertionError("counting did not finish")
