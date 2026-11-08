"""One organism is counted once: track pieces join, and the survey pole is never a fish."""
from __future__ import annotations

from tide.config import FixedStructureConfig, load_vision_config
from tide.detect import Detection
from tide.fixed import find_fixed, on_fixed
from tide.track import VideoTracker, merge_fragments


def _d(t, box, tid=None, conf=0.25):
    return Detection(int(t * 5), t, box, "fish", conf, tid)


def test_unconfirmed_boxes_keep_one_id_across_pictures():
    """A faint fish the tracker never confirms is one organism, not a new one in every picture."""
    tr = VideoTracker("v", load_vision_config().track, 5)
    ids = set()
    for i in range(6):
        (d,) = tr.update([_d(i / 5, (100 + i * 2, 100, 140 + i * 2, 120), conf=0.25)])
        ids.add(d.track_id)
    assert len(ids) == 1


def test_merge_fragments_joins_pieces_but_not_two_fish_at_once():
    a = [_d(0.0, (0, 0, 20, 10), "a"), _d(0.2, (5, 0, 25, 10), "a")]
    b = [_d(0.6, (12, 0, 32, 10), "b"), _d(0.8, (16, 0, 36, 10), "b")]  # carries on where a stopped
    far = [_d(0.6, (500, 400, 520, 410), "far")]  # somewhere else: another fish
    together = [_d(0.2, (30, 0, 50, 10), "c")]  # seen at the same moment as a: another fish
    joined = merge_fragments(a + b + far + together, max_gap_s=1.0, max_distance=1.5)
    assert joined == {"b": "a"}
    assert {d.track_id for d in b} == {"a"} and far[0].track_id == "far"


def test_merge_fragments_respects_the_gap():
    a = [_d(0.0, (0, 0, 20, 10), "a")]
    late = [_d(2.0, (2, 0, 22, 10), "late")]
    assert merge_fragments(a + late, max_gap_s=1.0, max_distance=1.5) == {}


def test_pole_markings_seen_all_video_are_fixed_but_a_passing_fish_is_not():
    cfg = FixedStructureConfig()
    band = (640, 210, 680, 225)
    searched = {}
    for f in range(20):
        dets = [_d(f / 5, (band[0] + (f % 2), band[1], band[2] + (f % 2), band[3]), conf=0.6)]
        if f < 4:  # a fish swimming past for a few pictures
            dets.append(_d(f / 5, (100 + 40 * f, 300, 160 + 40 * f, 330), conf=0.8))
        searched[f] = dets
    fixed = find_fixed(searched, 1280, cfg)
    assert len(fixed) == 1
    assert on_fixed(_d(0, band), fixed, cfg)
    assert on_fixed(_d(0, (655, 214, 662, 220)), fixed, cfg)  # a small motion blob on the band
    assert not on_fixed(_d(0, (100, 300, 160, 330)), fixed, cfg)
    assert find_fixed(searched, 1280, FixedStructureConfig(enabled=False)) == []


def test_fixed_needs_most_of_the_video():
    cfg = FixedStructureConfig()
    searched = {f: ([_d(f / 5, (10, 10, 30, 20))] if f < 8 else []) for f in range(20)}  # 40 % of the video
    assert find_fixed(searched, 1280, cfg) == []


def test_a_few_stray_boxes_dont_make_a_rock_move():
    cfg = FixedStructureConfig()
    rock = (1700, 770, 1790, 815)
    searched = {f: [_d(f / 5, rock if f not in (3, 11) else (1720, 778, 1810, 823))] for f in range(20)}
    assert len(find_fixed(searched, 1920, cfg)) == 1
