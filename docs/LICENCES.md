# Licence register

Every model, weight file, dataset, binary and dependency with a notable licence is listed here
**before** it is used (CLAUDE.md, hard constraint 3). Ultralytics YOLO (AGPL-3.0) is not allowed
without team and client approval.

## Python (tide/backend)

| Component | Version | Licence | Used for | Notes |
|---|---|---|---|---|
| opencv-python-headless | 5.0.0.93 | Apache 2.0 | Reading video frames, fallback clip writing | Wheels bundle an LGPL FFmpeg build (dynamically linked) |
| imageio-ffmpeg | 0.8.1 | BSD-2-Clause (wrapper only) | Provides FFmpeg for context clips | The FFmpeg program inside is **GPL-3.0**: see Binaries below |
| NumPy | 2.2.6 | BSD-3-Clause | Frame arrays | |
| PyYAML | 6.0.3 | MIT | `config/*.yaml` | |
| FastAPI, Uvicorn | see requirements.txt | MIT, BSD-3-Clause | Backend API | |
| PyInstaller | ≥ 6 | GPL-2.0 with bootloader exception | Building `tide-api.exe` | The exception allows bundling non-GPL apps |
| PyTorch (CUDA build) | 2.7.1+cu118, torchvision 0.22.1+cu118 | BSD-3-Clause | Inference runtime (detector, BioCLIP 2) | Bundles NVIDIA CUDA 11.8 runtime libraries (NVIDIA EULA, redistributable with the app) |
| rfdetr | 1.12.0 | Apache 2.0 | Runs the Community Fish Detector (RF-DETR) | Pulls in transformers (Apache 2.0) |
| open_clip_torch | 4.2.1 | MIT | Runs BioCLIP 2 | Pulls in timm (Apache 2.0), safetensors (Apache 2.0) |
| trackers | 2.7.0 | Apache 2.0 | ByteTrack implementation | |
| supervision | 0.31.5 | MIT | Box containers for the tracker | |
| Pillow | 13.0.0 | MIT-CMU | Picture handling for BioCLIP | |

## Binaries

| Component | Version | Licence | Used for | Notes |
|---|---|---|---|---|
| FFmpeg (with libx264) | 9.0.2, inside the `imageio-ffmpeg` 0.8.1 wheel (Windows x64: `ffmpeg-win-x86_64-v9.0.2.exe`, SHA-256 `3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec`) | **GPL-3.0-or-later** for this build (`--enable-gpl --enable-version3 --enable-libx264`) | Cutting context clips as H.264 so they play in the app | Runs as a separate program, not linked into TIDE. **Needs team and client approval before it ships.** Ship its licence text and a source offer with the installer. H.264 is also patent-encumbered: check before any wider release |

## App (tide/app)

| Component | Licence | Used for |
|---|---|---|
| Electron | MIT | Desktop app shell |
| React | MIT | Screens |
| Recharts | MIT | Trends charts |
| ExcelJS | MIT | Writing the `.xlsx` export |
| jsdom (dev-only) | MIT | Simulated browser page for Vitest tests (never shipped in the app) |
| @fontsource/sora, @fontsource/manrope | SIL OFL 1.1 | Bundled fonts (Sora, Manrope) |

## Default reference pictures (Species Registry)

225 photos (25 per species) from iNaturalist research-grade observations, licence **CC0 or CC-BY
only** (195 CC-BY, 30 CC0 when added). They are in this repo through Git LFS
(`tide/backend/models/reference-seed/`), with their species-model fingerprints. **Credits:** `tide/backend/config/reference_seed.json` lists
every photo with its observation link, the photographer's attribution and its licence; the app also
shows the credit as each picture's source. CC-BY requires that credit to stay with the photo
wherever it is shown or shipped (for example, include the list with the installer).

## Brand assets

| Asset | Source | Licence | Used for | Notes |
|---|---|---|---|---|
| Coastal Action logo (`app/src/renderer/src/assets/coastal-action-seal.png`) | coastalaction.org, resized | © Coastal Action; not openly licensed | Banner of the downloadable PDF report | **Needs Coastal Action's permission** before the app ships. Bundled, so the report stays offline |

## Models and data

| Component | Version | Licence | Notes |
|---|---|---|---|
| YOLOX | not yet added | Apache 2.0 | Record model size and weight file when added |
| **Community Fish Detector (interim detector)** | RF-DETR Medium 1024, release `2026.07.06-release`, file `cfd-rf-detr-medium-1024-2026.03.24.cp-011.20260706-release.pth` (SHA-256 `2e94814c…`) | **Needs team and client approval.** Inference code (rfdetr) is Apache 2.0; the weights' repository ([filippovarini/community-fish-detector](https://github.com/filippovarini/community-fish-detector)) has no licence file, and its training data (Community Fish Detection Dataset on LILA) combines datasets with different licences | Weights are in this repo through Git LFS (`tide/backend/models/cfd/`) since 2026-11-07. Stand-in until a fine-tuned YOLOX exists (CLAUDE.md names YOLOX). Swappable in `tide/detect.py`. Not Ultralytics. |
| BioCLIP 2 | `imageomics/bioclip-2` at commit `2957b322090f9cb17ae72c71981c7218a28d81e0` (SHA-256 of `open_clip_model.safetensors`: `b7b2bf6f…`) | MIT | Weights are in this repo through Git LFS (`tide/backend/models/bioclip-2/`). Species ID on detection crops (`tide/species.py`). ~1.7 GB of GPU memory in fp16 |
| ByteTrack | via `trackers` 2.7.0 | MIT (algorithm), Apache 2.0 (implementation) | `tide/track.py` |
