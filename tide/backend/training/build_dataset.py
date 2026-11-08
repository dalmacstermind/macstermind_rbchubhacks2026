"""Make a YOLOX (COCO-format) dataset of tiles from one or more label files, split by video.

    python -m training.build_dataset --labels a/labels.json b/labels.json --out data/training/set1 \
        --test-video "T1-STAT2 411"

Test videos are left out completely. Draft boxes are refused unless --allow-drafts is given.
"""
from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

import cv2

from .common import assign_splits, clip_box_to_tile, load_settings, read_json, tile_origins, write_json


def gather(paths: list[Path]) -> list[tuple[Path, dict, list[dict]]]:
    """(folder of the label file, image, its annotations) for every labelled frame."""
    out = []
    for path in paths:
        data = read_json(path)
        by_image: dict[int, list[dict]] = {}
        for a in data["annotations"]:
            by_image.setdefault(a["image_id"], []).append(a)
        out += [(path.parent, im, by_image.get(im["id"], [])) for im in data["images"]]
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--labels", type=Path, nargs="+", required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--test-video", action="append", default=[], help="video name kept out of training (repeatable)")
    ap.add_argument("--allow-drafts", action="store_true", help="experiments only: train on uncorrected boxes")
    args = ap.parse_args()
    cfg = load_settings()
    frames = gather(args.labels)
    drafts = sum(bool(a.get("draft")) for _, _, anns in frames for a in anns)
    if drafts and not args.allow_drafts:
        raise SystemExit(f"{drafts} boxes are still drafts. Correct them first, or pass --allow-drafts for an experiment.")
    if not all(im.get("video") for _, im, _ in frames):
        raise SystemExit("Every image needs a 'video' name, so the data can be split by video.")
    splits = assign_splits([im["video"] for _, im, _ in frames], cfg["split"]["val_fraction"], args.test_video)
    tile = cfg["tile"]
    categories = [{"id": i + 1, "name": c} for i, c in enumerate(cfg["classes"])]
    summary: dict[str, Counter] = {}
    for split, target in (("train", "train2017"), ("val", "val2017")):
        (args.out / target).mkdir(parents=True, exist_ok=True)
        images, annotations = [], []
        for root, im, anns in frames:
            if im["video"] not in splits[split]:
                continue
            frame = cv2.imread(str(root / im["file_name"]), cv2.IMREAD_COLOR)
            if frame is None:
                raise SystemExit(f"Can't read {root / im['file_name']}")
            h, w = frame.shape[:2]
            for y0 in tile_origins(h, tile["size_px"], tile["overlap_px"]):
                for x0 in tile_origins(w, tile["size_px"], tile["overlap_px"]):
                    crop = frame[y0:y0 + tile["size_px"], x0:x0 + tile["size_px"]]
                    image_id = len(images) + 1
                    name = f"{image_id:07d}.jpg"
                    cv2.imwrite(str(args.out / target / name), crop, [cv2.IMWRITE_JPEG_QUALITY, 95])
                    images.append({"id": image_id, "file_name": name, "width": crop.shape[1], "height": crop.shape[0]})
                    for a in anns:
                        box = clip_box_to_tile(a["bbox"], x0, y0, tile["size_px"], tile["min_box_visible"])
                        if box is not None:
                            annotations.append({"id": len(annotations) + 1, "image_id": image_id,
                                                "category_id": a["category_id"], "bbox": box,
                                                "area": box[2] * box[3], "iscrowd": 0})
        write_json(args.out / "annotations" / f"instances_{target}.json",
                   {"images": images, "annotations": annotations, "categories": categories})
        summary[split] = Counter(tiles=len(images), boxes=len(annotations))
    write_json(args.out / "dataset.json", {"splits": splits, "contains_drafts": bool(drafts), "classes": cfg["classes"]})
    print(f"Videos: {splits}")
    print(f"Tiles and boxes: { {k: dict(v) for k, v in summary.items()} }")
    if drafts:
        print("WARNING: this dataset contains uncorrected draft boxes. Don't report its results as accuracy.")


if __name__ == "__main__":
    main()
