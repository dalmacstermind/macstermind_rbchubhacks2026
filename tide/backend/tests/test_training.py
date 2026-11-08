"""YOLOX fine-tuning tools: split by video, tiling, staff dots, dot scoring."""
import numpy as np
import pytest

from training.common import assign_splits, clip_box_to_tile, find_dots, match_dots, tile_origins


def test_split_is_by_video_and_never_overlaps():
    s = assign_splits(["a", "a", "b", "c", "d", "e"], 0.2, ["e"])
    assert set(s["train"]).isdisjoint(s["val"])
    assert s["test"] == ["e"] and "e" not in s["train"] + s["val"]
    assert sorted(s["train"] + s["val"]) == ["a", "b", "c", "d"]


def test_split_refuses_a_single_video():
    with pytest.raises(ValueError, match="at least 2"):
        assign_splits(["only", "only"], 0.2, [])


def test_split_refuses_unknown_test_video():
    with pytest.raises(ValueError, match="nope"):
        assign_splits(["a", "b", "c"], 0.2, ["nope"])


def test_tiles_cover_the_whole_frame():
    starts = tile_origins(3840, 1280, 200)
    assert starts[0] == 0 and starts[-1] + 1280 == 3840
    assert all(b - a <= 1080 for a, b in zip(starts, starts[1:]))
    assert tile_origins(800, 1280, 200) == [0]


def test_box_mostly_outside_a_tile_is_dropped():
    assert clip_box_to_tile([10, 10, 20, 20], 0, 0, 100, 0.5) == [10, 10, 20, 20]
    assert clip_box_to_tile([95, 10, 20, 20], 0, 0, 100, 0.5) is None
    assert clip_box_to_tile([200, 10, 20, 20], 0, 0, 100, 0.5) is None


def test_find_dots_ignores_lines_and_low_dots():
    img = np.full((1000, 1000, 3), 120, np.uint8)
    img[100:103, 100:103] = 0  # a dot
    img[400:403, 500:503] = 0  # another
    img[50, :] = 0  # a grid line
    img[900:903, 200:203] = 0  # below the counted rows
    found = find_dots(img, max_y_frac=0.665)
    assert len(found) == 2 and {round(y) for _, y in found} == {101, 401}


def test_each_box_can_only_claim_one_dot():
    assert match_dots([(10, 10), (12, 10)], [(0, 0, 20, 20)], 10) == (1, 0)
    assert match_dots([(10, 10)], [(0, 0, 20, 20), (500, 500, 510, 510)], 10) == (1, 1)
    assert match_dots([(100, 100)], [(0, 0, 20, 20)], 10) == (0, 1)
