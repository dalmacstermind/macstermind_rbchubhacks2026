"""Turn staff's dotted screenshots into draft labels on the original video frames.

    python -m training.dots_to_drafts --manifest frames.csv --out data/training/drafts

The manifest is a CSV with columns: screenshot, video, time_s. Every box made here is a fixed-size
placeholder around a staff dot, marked "draft": true. A person must correct them before real training.
"""
from __future__ import annotations

import argparse
import csv
from pathlib import Path
from typing import Iterator

import cv2
import numpy as np

from .common import find_dots, load_settings, write_json

ALIGN_WIDTH = 960


def read_frames(cap: cv2.VideoCapture, t0: float, t1: float) -> Iterator[tuple[float, np.ndarray]]:
    """Yield frames one at a time: holding a few seconds of 4K in memory runs out of RAM."""
    cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, t0 - 1.0) * 1000)
    while cap.grab():
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
        if t > t1:
            break
        if t >= t0:
            ok, frame = cap.retrieve()
            if ok:
                yield t, frame


def _detail(img: np.ndarray) -> np.ndarray:
    grey = cv2.cvtColor(cv2.resize(img, (ALIGN_WIDTH, 540), interpolation=cv2.INTER_AREA),
                        cv2.COLOR_BGR2GRAY).astype(np.float32)
    return grey - cv2.GaussianBlur(grey, (0, 0), 6)


def water_mask(shot: np.ndarray) -> np.ndarray:
    """Open-water pixels: the seabed never changes, so only the water can tell frames apart."""
    grey = cv2.cvtColor(cv2.resize(shot, (ALIGN_WIDTH, 540), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    mask = cv2.erode((grey > 25).astype(np.uint8), np.ones((7, 7), np.uint8)).astype(bool)
    mask[:60] = False  # handwritten counts
    mask[330:] = False
    mask[:, 470:530] = False  # the pole
    return mask


def align(cap: cv2.VideoCapture, shot: np.ndarray, t: float, window: float) -> tuple[float, float, np.ndarray]:
    """The video frame that best matches the screenshot: (similarity, time, frame)."""
    target, mask = _detail(shot), water_mask(shot)
    best: tuple[float, float, np.ndarray] | None = None
    for ft, frame in read_frames(cap, t - window, t + window):
        score = float(np.corrcoef(target[mask], _detail(frame)[mask])[0, 1])
        if best is None or score > best[0]:
            best = (score, ft, frame.copy())
    if best is None:
        raise ValueError(f"No video frames near {t} s.")
    return best


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    cfg = load_settings()
    draft = cfg["draft"]
    images, annotations = [], []
    (args.out / "frames").mkdir(parents=True, exist_ok=True)
    (args.out / "review").mkdir(parents=True, exist_ok=True)
    with open(args.manifest, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    for row in rows:
        shot = cv2.imread(row["screenshot"], cv2.IMREAD_COLOR)
        if shot is None:
            print(f"SKIPPED, can't read: {row['screenshot']}")
            continue
        cap = cv2.VideoCapture(row["video"])
        if not cap.isOpened():
            print(f"SKIPPED, can't open: {row['video']}")
            continue
        score, t, frame = align(cap, shot, float(row["time_s"]), draft["align_window_s"])
        cap.release()
        h, w = frame.shape[:2]
        sx, sy = w / shot.shape[1], h / shot.shape[0]
        k = w / 3840
        bw, bh = draft["box_w"] * k, draft["box_h"] * k
        video = Path(row["video"]).stem
        name = f"{video}_{t:09.2f}.png".replace(" ", "_")
        cv2.imwrite(str(args.out / "frames" / name), frame)
        image_id = len(images) + 1
        images.append({"id": image_id, "file_name": f"frames/{name}", "width": w, "height": h, "video": video,
                       "time_s": round(t, 3), "align_score": round(score, 3)})
        review = frame.copy()
        for x, y in find_dots(shot, draft["max_y_frac"]):
            px, py = x * sx, y * sy
            box = [max(0.0, px - bw / 2), max(0.0, py - bh / 2), bw, bh]
            annotations.append({"id": len(annotations) + 1, "image_id": image_id, "category_id": 1, "bbox": box,
                                "area": bw * bh, "iscrowd": 0, "draft": True, "point": [px, py]})
            cv2.rectangle(review, (int(box[0]), int(box[1])), (int(box[0] + bw), int(box[1] + bh)), (0, 255, 255), 2)
        cv2.imwrite(str(args.out / "review" / f"{Path(name).stem}.jpg"), review, [cv2.IMWRITE_JPEG_QUALITY, 90])
        n = sum(a["image_id"] == image_id for a in annotations)
        print(f"{name}: {n} dots, matched video at {t:.2f} s (similarity {score:.2f})")
    categories = [{"id": i + 1, "name": c} for i, c in enumerate(cfg["classes"])]
    write_json(args.out / "labels.json", {"images": images, "annotations": annotations, "categories": categories})
    print(f"Wrote {args.out / 'labels.json'}. Every box is a draft: correct them before real training.")


if __name__ == "__main__":
    main()
