"""Score a fine-tuned YOLOX against staff's dotted frames, the way the protocol scores a human counter.

    python -m training.evaluate_dots --run data/training/runs/tide_yolox --labels data/training/drafts/labels.json

Reports per frame: staff count, model count, absolute and % difference, dots found. Use frames from
videos that were NOT used for training; frames from a training video are refused.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np

from .common import SIZES, load_settings, match_dots, read_json, tile_origins, use_yolox


def load_model(run: Path, info: dict):
    use_yolox()
    import torch
    from yolox.models import YOLOX, YOLOPAFPN, YOLOXHead

    depth, width = SIZES[info["size"]]
    channels = [256, 512, 1024]
    model = YOLOX(YOLOPAFPN(depth, width, in_channels=channels), YOLOXHead(len(info["classes"]), width, in_channels=channels))
    model.load_state_dict(torch.load(run / "tide_weights.pth", map_location="cpu", weights_only=True)["model"])
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device).eval()
    model.head.decode_in_inference = True
    return model, device


def predict_tile(model, device: str, tile: np.ndarray, input_px: int) -> np.ndarray:
    """Rows of x1, y1, x2, y2, score, class in tile pixels. Square padding matches YOLOX training."""
    import torch

    h, w = tile.shape[:2]
    r = min(input_px / h, input_px / w)
    canvas = np.full((input_px, input_px, 3), 114, np.uint8)
    canvas[:int(h * r), :int(w * r)] = cv2.resize(tile, (int(w * r), int(h * r)), interpolation=cv2.INTER_LINEAR)
    x = torch.from_numpy(canvas.transpose(2, 0, 1)).float().unsqueeze(0).to(device)
    with torch.no_grad(), torch.autocast(device, enabled=device == "cuda"):
        p = model(x)[0].float().cpu().numpy()
    scores = p[:, 4] * p[:, 5:].max(1)
    cx, cy, bw, bh = p[:, 0] / r, p[:, 1] / r, p[:, 2] / r, p[:, 3] / r
    return np.c_[cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2, scores, p[:, 5:].argmax(1)]


def detect_frame(model, device: str, frame: np.ndarray, input_px: int, tile: dict, conf: float, iou: float) -> np.ndarray:
    import torch
    import torchvision

    h, w = frame.shape[:2]
    rows = []
    for y0 in tile_origins(h, tile["size_px"], tile["overlap_px"]):
        for x0 in tile_origins(w, tile["size_px"], tile["overlap_px"]):
            p = predict_tile(model, device, frame[y0:y0 + tile["size_px"], x0:x0 + tile["size_px"]], input_px)
            p = p[p[:, 4] >= conf]
            p[:, [0, 2]] += x0
            p[:, [1, 3]] += y0
            rows.append(p)
    a = np.vstack(rows)
    keep = torchvision.ops.nms(torch.tensor(a[:, :4], dtype=torch.float32), torch.tensor(a[:, 4], dtype=torch.float32), iou)
    return a[keep.numpy()]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", type=Path, required=True)
    ap.add_argument("--labels", type=Path, required=True)
    ap.add_argument("--conf", type=float)
    args = ap.parse_args()
    cfg = load_settings()
    ev = cfg["evaluate"]
    info = read_json(args.run / "tide_model.json")
    data = read_json(args.labels)
    trained_on = set(info["splits"]["train"]) | set(info["splits"]["val"])
    leaked = sorted({im["video"] for im in data["images"]} & trained_on)
    if leaked:
        raise SystemExit(f"These videos were used in training, so the score would be meaningless: {', '.join(leaked)}")
    conf = args.conf if args.conf is not None else ev["conf_threshold"]
    model, device = load_model(args.run, info)
    within = total = found_all = dots_all = 0
    print("frame | staff | model | abs diff | % diff | dots found | other boxes")
    for im in data["images"]:
        frame = cv2.imread(str(args.labels.parent / im["file_name"]), cv2.IMREAD_COLOR)
        k = 1920 / frame.shape[1]
        boxes = detect_frame(model, device, frame, info["input_px"], cfg["tile"], conf, ev["nms_iou"])
        points = [[v * k for v in a["point"]] for a in data["annotations"] if a["image_id"] == im["id"] and "point" in a]
        scaled = [[float(v) * k for v in b[:4]] for b in boxes]
        found, spare = match_dots(points, scaled, ev["match_radius_px"])
        staff, ai = len(points), len(boxes)
        pct = 100 * abs(staff - ai) / staff if staff else (0.0 if ai == 0 else float("inf"))
        within += pct < ev["max_pct_diff"]
        total += 1
        found_all += found
        dots_all += staff
        print(f"{im['file_name']} | {staff} | {ai} | {abs(staff - ai)} | {pct:.1f} | {found}/{staff} | {spare}")
    print(f"Within {ev['max_pct_diff']} %: {within}/{total} frames. Dots found overall: {found_all}/{dots_all}.")
    if info.get("contains_drafts"):
        print("WARNING: trained on uncorrected draft boxes. This is an experiment, not an accuracy figure.")


if __name__ == "__main__":
    main()
