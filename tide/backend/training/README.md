# YOLOX fine-tuning (developers only)

Trains a fish and invertebrate detector on Coastal Action's own footage. The app never imports this
folder and it isn't in the installer. Run everything from `tide/backend` with the backend's venv.
Keep all frames, labels and runs under `data/` (git-ignored). Never commit them.

## 1. Set up (once, needs internet)

    python -m training.setup_yolox

Puts the pinned YOLOX 0.3.0 source, the starting weights and training-only packages in
`training/third_party/` (git-ignored), so the app's environment stays clean.

## 2. Make draft labels from dotted screenshots

Staff's gridded screenshots have a dot on each fish. List them in a CSV with columns
`screenshot,video,time_s`, then:

    python -m training.dots_to_drafts --manifest frames.csv --out data/training/drafts

This finds the matching video frame and draws a same-size placeholder box on each dot. Check
`review/` to see them.

## 3. Correct the boxes

Every box is marked `"draft": true`. A person has to fit each box to its fish in `labels.json`, then
remove the `draft` flag. Add fish, crabs and empty seabed from several videos.

## 4. Build the dataset, split by video

    python -m training.build_dataset --labels data/training/drafts/labels.json \
        --out data/training/set1 --test-video "T1-STAT2 411"

It stops if fewer than 2 videos remain, or if any box is still a draft. `--allow-drafts` is for
experiments only.

## 5. Train

    python -m training.train_yolox --dataset data/training/set1 --out data/training/runs

Settings are in `training.yaml`. Use `--size s` on a 4 GB GPU and `--size m` on 12 GB.

## 6. Score against staff dots

    python -m training.evaluate_dots --run data/training/runs/tide_yolox --labels <test labels.json>

Reports each frame the way the protocol scores a human: count, absolute and % difference, and share
within 6 %. It refuses videos that were used in training. Report only these measured numbers.
Coastal Action's past completed spreadsheets are the main test set and must never be trained on.

Connecting a trained model to the app (`tide/detect.py`) is a separate step, once it beats the
current detector on videos it has never seen.
