# Licence register

Every model, weight file, dataset, binary and dependency with a notable licence is listed here
**before** it is used (CLAUDE.md, hard constraint 3). Ultralytics YOLO (AGPL-3.0) is not allowed
without team and client approval.

## Python (fincount/backend)

| Component | Version | Licence | Used for | Notes |
|---|---|---|---|---|
| opencv-python-headless | 5.0.0.93 | Apache 2.0 | Reading video frames, fallback clip writing | Wheels bundle an LGPL FFmpeg build (dynamically linked) |
| NumPy | 2.2.6 | BSD-3-Clause | Frame arrays | |
| PyYAML | 6.0.3 | MIT | `config/*.yaml` | |
| FastAPI, Uvicorn | see requirements.txt | MIT, BSD-3-Clause | Backend API | |
| PyInstaller | ≥ 6 | GPL-2.0 with bootloader exception | Building `fincount-api.exe` | The exception allows bundling non-GPL apps |
| PyTorch (CUDA build) | not yet added | BSD-3-Clause | Inference runtime for YOLOX and BioCLIP | Add exact version and CUDA libraries when installed |

## Binaries

| Component | Version | Licence | Used for | Notes |
|---|---|---|---|---|
| FFmpeg (with libx264) | not yet bundled | **GPL-2.0-or-later** (libx264 is GPL) | Cutting context clips as H.264 so they play in the app | Runs as a separate program (`clips.ffmpeg_path`), not linked into TIDE. Ship its licence text and a source offer with the installer |

## App (fincount/app)

| Component | Licence | Used for |
|---|---|---|
| Electron | MIT | Desktop app shell |
| React | MIT | Screens |
| Recharts | MIT | Trends charts |
| ExcelJS | MIT | Writing the `.xlsx` export |
| @fontsource/sora, @fontsource/manrope | SIL OFL 1.1 | Bundled fonts (Sora, Manrope) |

## Models and data

| Component | Version | Licence | Notes |
|---|---|---|---|
| YOLOX | not yet added | Apache 2.0 | Record model size and weight file when added |
| BioCLIP | not yet added | MIT | Record exact model when added |
| ByteTrack | not yet added | MIT | |
