# TIDE

Offline fish detection, identification and counting for Nova Scotia underwater survey video.
TIDE installs on Windows as **one app**. Inside it are two parts that run on the same computer:

```
 TIDE.exe (Electron)                                   tide-api.exe (FastAPI)
 ┌───────────────────────────┐   HTTP on 127.0.0.1 only    ┌─────────────────────────────┐
 │ React screens   app/      │ ─────────────────────────▶  │ backend/                    │
 │ starts & stops the back   │   (never leaves the PC,     │  video → pictures → model   │
 │ end, file pickers, PDFs   │    works with Wi-Fi off)    │  SQLite database, pictures  │
 └───────────────────────────┘                             └─────────────────────────────┘
```

When staff open TIDE, Electron starts the back end in the background on a free port with
a random password (token), shows "Starting TIDE…" until it answers, and stops it on close.

| Folder | Who works on it | What's there |
| --- | --- | --- |
| `app/` | UI | Electron + React + Vite. Screens are in `app/src/renderer/src/App.tsx` |
| `backend/` | Integration | FastAPI. The pipeline to fill in is `backend/tide_api/pipeline.py` |
| `API.md` | Everyone | The contract between the two. **Agree changes here first.** |
| `backend/models/` | Model | The detector (CFD) and BioCLIP 2 weights, in Git LFS. Later: `fish.onnx` + `labels.json` once trained |

**What the app does:** pick who's working → add footage or a whole folder → count → report →
check the fish → export to Excel or PDF. Also: blind QC by a second person, trends over time,
an editable species list (fish and invertebrates), settings, light/dark mode, and keyboard
shortcuts (press `?`).

**The back end runs real models when their files are installed** (`backend/models/`, stored with Git LFS):
the Community Fish Detector (RF-DETR) finds fish, ByteTrack follows each fish across pictures, and
BioCLIP 2 suggests species by comparing each fish with the **reference pictures** staff add to the
species list. Every picture also gets a clarity index. Without the model files the app runs in
**Demo mode** with sample pictures and says so. The model files (about 1.8 GB) are in the repo
through [Git LFS](https://git-lfs.com): install it before cloning, or fetch them afterwards:

```sh
git lfs install
git lfs pull                         # downloads the weights into backend/models
cd backend
python -m tide.fetch_models --verify # checks them against the pinned SHA-256
```

Without Git LFS, `python -m tide.fetch_models` downloads the same pinned files from their sources.

Tests of the real models: `pytest -m models` (the default `pytest` run uses small test models).

**Videos follow the FFH protocol:** analysis window, subsample points with context clips, counting
within ±0.5 s with tracking (one fish counted once), MeanCount, species richness from a full-window
scan, and a clarity index. Staff label the fish the AI couldn't name on the **Label unknown fish** page.

**Accuracy is not measured yet:** there are no hand-counted results to compare with. To measure it,
compare the AI with hand counts of the same points (Coastal Action's past spreadsheets, exported to a
CSV with columns `video, point, total_fish`): in the app, **Tools → Settings → Accuracy check → Compare with hand counts…**, or

```sh
python -m tide.evaluate --results results.json --human hand_counts.csv
```

(`results.json` is saved from `GET /surveys/{id}/results`). It reports per-point differences, the share
of points within 6 %, MeanCount per video and zero-point agreement, the way the protocol checks a person.

## Run it (development)

### 1. Check you have the tools

| You need | Check with | Get it |
| --- | --- | --- |
| **Node.js 22 or newer** | `node --version` | https://nodejs.org (the LTS download) |
| **Python 3.11 or newer** | Mac: `python3 --version` · Windows: `py --version` | https://www.python.org/downloads |
| **Git** (to clone) | `git --version` | https://git-scm.com |

On Windows, tick **"Add python.exe to PATH"** when installing Python.

### 2. Set up the back end (once)

The app looks for the back end's Python packages in **`backend/.venv`**, so the virtual environment
must be created there with exactly that name. From the project folder:

**Mac / Linux**

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
deactivate
cd ..
```

**Windows (PowerShell)**

```powershell
cd backend
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
deactivate
cd ..
```

If PowerShell refuses to run `Activate.ps1`, run
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, then try again.

**Check it worked:** `backend/.venv/bin/python --version` (Mac) or
`backend\.venv\Scripts\python --version` (Windows) prints a Python version.

### 3. Set up the app (once)

```sh
cd app
npm install
```

`npm install` also downloads Electron itself (about 100 MB), so it can take a minute.

**Check it worked:** `ls node_modules/electron/dist` (Mac) or `dir node_modules\electron\dist`
(Windows) lists `Electron.app` or `electron.exe`.

**If it's missing,** or `npm run dev` later says `Error: Electron uninstall`, Electron's download
step was skipped. In the same folder, run:

```sh
node node_modules/electron/install.js
```

Then carry on with step 4. If that doesn't help, see **Troubleshooting** below.

### 4. Run it (every time)

```sh
cd app
npm run dev
```

The TIDE window opens and shows "Starting TIDE…" for a moment. The app starts the back end
for you, using `backend/.venv`, so you don't need to activate anything. Screens reload as soon as
you save a change.

**Working on the back end?** Start it yourself first with auto-reload, and the app will use it
instead of starting its own:

```sh
cd backend
source .venv/bin/activate        # Windows: .venv\Scripts\Activate.ps1
uvicorn tide_api.main:app --port 8765 --reload
```

Then open **http://127.0.0.1:8765/docs** to try every endpoint in the browser.

### Other commands

| Command | Where | What it does |
| --- | --- | --- |
| `npm test` | `app/` | Tests for the counting rules and QC |
| `npm run typecheck` | `app/` | Check for TypeScript errors |
| `pytest` (with `.venv` active) | `backend/` | API tests (species, analysis, checks, people, blind QC, upgrades, token) |

Where data goes: when the app starts the back end in development, it uses your app data folder
under `TIDE/dev-data/` (Mac: `~/Library/Application Support/TIDE/dev-data`). When you start
uvicorn yourself, it uses `backend/data/`. The installed app uses `%APPDATA%\TIDE\` on Windows.
To start fresh, quit the app and delete that folder.

### Troubleshooting

**`Error: Electron uninstall`** when running `npm run dev`
Electron's download step didn't run. In `app/`:

```sh
node node_modules/electron/install.js
```

If that doesn't help, check `npm config get ignore-scripts`. If it says `true`, run
`npm config set ignore-scripts false`, delete `node_modules`, and run `npm install` again.

**"TIDE couldn't start" with `No module named 'uvicorn'`** (or `fastapi`)
The back end's packages aren't installed where the app looks for them. Do step 2 again, making sure
the folder is `backend/.venv`. A virtual environment anywhere else, or packages installed into your
system Python, won't be found.

**"TIDE couldn't start" with `Couldn't start the back end (python3)`**
There's no `backend/.venv` and Python isn't on your PATH. Do step 2.

**`[Errno 48] Address already in use`** (Windows: `10048`)
Something else is using port 8765, usually a back end you started yourself and forgot. Stop it
(Ctrl+C in its terminal), or start the app on another port:
`TIDE_API_URL=http://127.0.0.1:8766 npm run dev`.

**`pip install` fails**
Check `python3 --version` (Windows: `py --version`) is 3.11 or newer. If you upgraded Python,
delete `backend/.venv` and do step 2 again.

**The window opens but stays blank**
Look at the terminal where you ran `npm run dev` for the error, then quit with Ctrl+C and run it again.

## Building TIDE for Windows

Staff use Windows, so TIDE is built on Windows in two steps. It ships as a **`.zip` of the app
folder**, not an installer (see "Why a .zip" below).

1. **Back end → `tide-api.exe`** with PyInstaller, using the recipe in
   [`tide/backend/tide-api.spec`](tide/backend/tide-api.spec). It makes one folder,
   `tide/backend/dist/tide-api/`, with the config, the models (`models/`), FFmpeg and the ML
   packages (PyTorch, rfdetr, open_clip, transformers) inside `_internal/`.
2. **App → `TIDE-0.1.0-win-x64.zip`** with electron-builder
   ([`tide/app/electron-builder.yml`](tide/app/electron-builder.yml)), which puts the folder from
   step 1 in `resources/backend/`. `TIDE.exe` starts `tide-api.exe` itself (no window shows).

### Easiest: GitHub Actions (no Windows PC needed)

The workflow is [`.github/workflows/build-windows.yml`](.github/workflows/build-windows.yml). It
installs the back end, runs the back-end and app tests, then builds the zip. It runs when you:

- **push to `release`** (including merging a pull request into it), or
- **push a branch whose name starts with `build/`** (for example `build/windows-installer`), or
- **push a tag starting with `v`** (for example `v0.1.0`), or
- click **Actions → Build Windows installer → Run workflow** (only once the workflow file is on `main`).

TIDE is built from the code **on that branch or tag**, so commit and push your changes first.

**To download it:** open the finished run in the **Actions** tab, scroll to **Artifacts** and
download **TIDE-Windows**. GitHub wraps it in another `.zip`: unzip that to get
`TIDE-0.1.0-win-x64.zip`. Or from a terminal:

```bash
gh run download <run-id> -n TIDE-Windows -D TIDE-download
```

### Or on a Windows PC

From the repo root. Needs **Python 3.11** (the back-end `.venv`, set up as in "Run it" above), Node 22, and about
**15 GB of free disk space** (the back-end folder alone is over 5 GB). Model files come through
Git LFS: run `git lfs pull` first.

```bat
cd tide\backend
.venv\Scripts\activate
pip install -r requirements-dev.txt
pyinstaller tide-api.spec --noconfirm
cd ..\app
npm ci
npm run dist:win
```

The zip appears in `tide\app\release\` (the unzipped app is in `tide\app\release\win-unpacked\`). To check the back end on its own before step 2:
run `dist\tide-api\tide-api.exe --port 51999` and open `http://127.0.0.1:51999/health`.

### Installing

Unzip `TIDE-0.1.0-win-x64.zip` somewhere permanent (for example `C:\TIDE`; about 7 GB), open the
folder and run **`TIDE.exe`**. Keep all the files together: `TIDE.exe` needs the `resources` folder
next to it. There's no installer, so make a desktop shortcut yourself (right-click `TIDE.exe` →
**Show more options → Send to → Desktop**). To remove TIDE, delete the folder (survey data stays in
`%APPDATA%\TIDE`).

It's unsigned, so Windows shows **"Windows protected your PC"**; click **More info → Run anyway**.

**Unzip it on a real Windows laptop and run one survey before the demo.**
If Windows Defender complains about `tide-api.exe` (it happens with PyInstaller), that's the
thing to sort out early.

### Known problems

- **Why a .zip, not an installer.** The app is about 7 GB unpacked (PyTorch's CUDA libraries ~3 GB,
  models ~1.8 GB). An NSIS installer can't hold more than about 2 GB: the first CI build failed
  there. A real installer would need a smaller app (CPU-only PyTorch saves ~3 GB, but the models
  still don't fit) or the models downloaded separately after installing.
- **`*.spec` is ignored** by the root `.gitignore` (PyInstaller template); `tide-api.spec` has an
  exception there. Keep it if you change that file.

## Notes for the integration team

- Always build the back end from a **clean virtual environment**. PyInstaller bundles whatever is
  installed, so stray packages make the app bigger.
- The runtime is **PyTorch (CUDA build)**, per CLAUDE.md; it also runs on CPU. The packaged back end
  is several GB with the models, so it ships as a .zip, not an NSIS installer (see "Building TIDE for Windows").
- FFmpeg (for context clips that play in the app) and the models are bundled by `tide-api.spec`
  (`collect_data_files("imageio_ffmpeg", subdir="binaries")`, and `config/` + `models/` side by side
  in `_internal/`, because `models.dir` in `config/app.yaml` is relative to the config folder).
  FFmpeg's licence is GPL-3.0 (docs/LICENCES.md).
- The detector is the **Community Fish Detector (RF-DETR)** until a fine-tuned YOLOX exists. Its licence
  needs approval: see `docs/LICENCES.md`.
- Error messages in `HTTPException` and `Job.error` are shown to staff, so keep them plain English.
