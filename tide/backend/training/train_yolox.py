"""Fine-tune YOLOX on a dataset made by build_dataset.

    python -m training.train_yolox --dataset data/training/set1 --out data/training/runs
"""
from __future__ import annotations

import argparse
from argparse import Namespace
from pathlib import Path

from .common import SIZES, WEIGHTS, load_settings, read_json, use_yolox, write_json


def make_exp(dataset: Path, out: Path, name: str, size: str, classes: int, input_px: int, epochs: int, eval_every: int):
    from yolox.exp import Exp

    exp = Exp()
    exp.exp_name = name
    exp.depth, exp.width = SIZES[size]
    exp.num_classes = classes
    exp.data_dir = str(dataset.resolve())
    exp.train_ann, exp.val_ann = "instances_train2017.json", "instances_val2017.json"
    exp.input_size = exp.test_size = (input_px, input_px)
    exp.multiscale_range = 3
    exp.max_epoch = epochs
    exp.no_aug_epochs = min(15, max(0, epochs // 5))
    exp.warmup_epochs = min(5, max(0, epochs // 5))
    exp.eval_interval = eval_every
    exp.print_interval = 5
    exp.data_num_workers = 0  # Windows: worker processes cost more than they save at this batch size
    exp.output_dir = str(out.resolve())
    return exp


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--name", default="tide_yolox")
    ap.add_argument("--size", choices=sorted(SIZES))
    ap.add_argument("--epochs", type=int)
    ap.add_argument("--batch", type=int)
    args = ap.parse_args()
    cfg = load_settings()["train"]
    info = read_json(args.dataset / "dataset.json")
    use_yolox()
    import torch
    import yolox.layers
    from yolox.core import Trainer

    # YOLOX's fast scorer needs a C++ compiler at run time and crashes without one. With it removed,
    # YOLOX uses the standard pycocotools scorer, which gives the same numbers more slowly.
    if hasattr(yolox.layers, "COCOeval_opt"):
        del yolox.layers.COCOeval_opt

    size = args.size or cfg["size"]
    epochs = args.epochs or cfg["epochs"]
    batch = args.batch or cfg["batch"]
    exp = make_exp(args.dataset, args.out, args.name, size, len(info["classes"]), cfg["input_px"], epochs,
                   min(cfg["eval_interval"], epochs))
    run = args.out / args.name
    # Written first so a run that stops early can still be evaluated with the right settings.
    write_json(run / "tide_model.json", {"size": size, "input_px": cfg["input_px"], "classes": info["classes"],
                                         "contains_drafts": info["contains_drafts"], "splits": info["splits"]})
    Trainer(exp, Namespace(experiment_name=args.name, batch_size=batch, devices=1, resume=False,
                           ckpt=str(WEIGHTS / f"yolox_{size}.pth"), start_epoch=None, num_machines=1, machine_rank=0,
                           fp16=torch.cuda.is_available(), occupy=False, cache=None, logger="tensorboard")).train()
    # YOLOX checkpoints also hold training state that PyTorch's safe loader refuses. This run just wrote
    # the file, so it is opened here once and only the weights are kept, for safe loading from then on.
    best = run / "best_ckpt.pth"
    if not best.is_file():
        raise SystemExit("Training ended without a best model: validation never scored above zero.")
    weights = {"model": torch.load(best, map_location="cpu", weights_only=False)["model"]}
    torch.save(weights, run / "tide_weights.pth")
    print(f"Finished. Weights: {run / 'tide_weights.pth'}")


if __name__ == "__main__":
    main()
