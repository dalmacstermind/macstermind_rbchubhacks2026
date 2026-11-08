# CLAUDE.md – TIDE

Context for Claude Code working in this repository. Read this before making changes.

## What this project is

**TIDE** is an RBC HubHacks (3-day hackathon) prototype for **Coastal Action** (Nova Scotia).
It automates Coastal Action's **DRAFT Fish and Fish Habitat (FFH) Video Analysis Protocol**:
it analyzes stationary, unbaited remote underwater videos (RUVs), counts fish and invertebrates
at systematic subsample points, identifies supported species, computes **MeanCount** and
**species richness**, and fills Coastal Action's spreadsheet. Humans review uncertain items and
run blind quality control (QC).

Staff use the **TIDE desktop app** (Electron + React, built on the FinCount code base in
`fincount/`). They add **videos, images, folders, or ZIP files containing images and videos
together** by drag and drop or a file picker. Files are read where they are on this computer;
nothing is uploaded anywhere.

**Naming:** the product is called **TIDE** in every user-facing place (window title, sidebar,
installer, exports, notifications). The code still uses the FinCount names (`fincount/`,
`fincount_api`, `FINCOUNT_*` environment variables, `X-FinCount-Token`, `%APPDATA%\FinCount\`)
until a dedicated rename task changes them; do not rename these piecemeal. The old working name
"AquaVision AI" is retired.

The project does not invent a new method. When in doubt, do what the protocol says.

## Hard constraints (do not break these)

1. **Offline-first.** The app must run with no internet after installation. No cloud AI, no hosted
   inference APIs, no telemetry, no downloading weights at runtime. All model weights live in
   `models/` and are loaded from disk.
   The app counts too: no CDN scripts, no Google Fonts, no analytics, no external images.
   Everything is bundled by Vite into the Electron app (fonts via `@fontsource`).
2. **Local only.** The backend binds to `127.0.0.1` and requires the random token Electron passes
   at start-up. The app gives the backend local file paths; media never leaves this computer.
3. **Open-source models only**, with permissive licences. The detector is **YOLOX** (Apache 2.0).
   Do **not** add Ultralytics YOLO (YOLOv8/YOLO11, AGPL-3.0) without team and client approval. Every new model, weight file, dataset or npm/pip dependency with an unusual
   licence must be added to `docs/LICENCES.md` before it is used. Electron, Recharts, ExcelJS,
   `@fontsource` (Sora, Manrope: SIL OFL) and PyInstaller are already in use and must be listed there.
4. **Never commit media or client data.** No videos, images, ZIPs, extracted frames, or Coastal
   Action spreadsheets in git. `data/` and `models/` are git-ignored.
5. **Conservative counting.** The protocol prefers undercounting to counting algae, sediment or
   bubbles. Uncertain detections become notes or review items, not counts.
6. **Protocol values are settings, not constants.** Every protocol parameter comes from
   `config/protocol.yaml`; app settings and limits come from `config/app.yaml`. Never hard-code
   them, and never keep them only in the app's `localStorage`.
7. **Never present cached demo results as live inference.**
8. **Never label a species "invasive" or "unusual" automatically, and never raise invasive
   alerts.** A species' status is a human note in the registry; the AI, reports and exports never
   infer or headline it.

## Target hardware

- Primary: Coastal Action's planned AI computer with a **12 GB NVIDIA GPU** (**PyTorch + CUDA**,
  fp16). PyTorch is the inference runtime for YOLOX and BioCLIP.
- Fallback: CPU-only laptop (YOLOX-s exported to ONNX, run with ONNX Runtime; BioCLIP on PyTorch
  CPU). The full pipeline must still run on CPU, just slower. GPU/CPU is chosen automatically at
  backend start-up and shown in the UI ("GPU mode" / "CPU mode").
- The vision pipeline should stay around 3–5 GB of VRAM. Flag any change that would push it
  near 12 GB.
- Videos are read in place; only extracted ZIPs, context clips, SQLite and exports are written to
  local disk. Check free space before extracting or processing.

## Architecture

```
TIDE desktop app (Electron)                     fincount-api.exe (FastAPI, PyInstaller)
 ┌───────────────────────────┐  HTTP 127.0.0.1  ┌──────────────────────────────────────┐
 │ main: starts/stops back    │  + random token  │ fincount_api/  routes, jobs, SQLite   │
 │ end, file pickers, saving  │ ───────────────▶ │ aquavision/    ingest → protocol →    │
 │ renderer: React screens    │                  │   frames → detect → species → track → │
 └───────────────────────────┘                  │   count → clarity → QC → export       │
                                                 └──────────────────────────────────────┘
```

- The **renderer** never touches files or models. It calls the backend only through
  `src/renderer/src/api.ts`, and Electron only through `window.desktop` (pickers, saving files,
  taskbar progress).
- The **backend** is a thin layer (`fincount_api/`) over the `aquavision` Python package. Pipeline
  and protocol logic lives in `aquavision/`, not in route handlers.
- **No protocol calculations in the renderer.** Counts, MeanCount, richness, clarity summaries and
  QC differences come from the backend; screens only display them.
- Long processing runs as a **background job** in the backend (a simple in-process worker queue;
  no Celery or Redis). The renderer polls `GET /analyses/{jobId}`.
- Electron starts the backend on a free port with a random token, shows "Starting TIDE…" until
  `/health` answers, and stops it when the app closes. In development, a backend you started
  yourself with uvicorn is reused.

## Packaging: Windows installer (no Docker)

Coastal Action staff cannot be expected to run Docker or terminal commands. The product ships as
one **Windows installer** built by electron-builder, containing the Electron app and the backend
(`fincount-api.exe`, built with PyInstaller). Staff run it once and open TIDE from the Start menu
or desktop. No Python, Node or terminal on their machine. Do not add Docker files.

- **Per-user install, no admin rights, works with no internet.**
- **PyTorch with CUDA** is bundled into the backend. CUDA wheels need only the NVIDIA driver, not
  the CUDA toolkit. Pin exact versions. Build the backend from a **clean venv**: PyInstaller bundles
  everything installed.
- **One package for GPU and CPU:** the CUDA build of PyTorch also runs on CPU. At start-up, check
  `torch.cuda.is_available()`; if false, switch to the CPU path (YOLOX-s ONNX) and show the mode
  in the UI.
- **Size (flagged):** a PyTorch CUDA backend plus weights is several GB. NSIS installers have a
  ~2 GB limit, so check the build early; if it is exceeded, ship the backend and `models/` as a
  separate offline folder that the installer copies, rather than inside one `.exe`.
- **Model weights** ship in the package under `models/`; nothing downloads at install or runtime.
- **Data folder outside the app folder:** `%APPDATA%\FinCount\` (extracted ZIPs, context clips,
  SQLite, exports), so reinstalling or updating never touches results.
- Built by GitHub Actions ("Build Windows installer") or on a Windows PC (see Commands).
- Test every installer on a clean Windows machine with the network disabled before calling it done.
- Roadmap: code signing (avoids the SmartScreen warning), side-by-side versions for rollback.

### Layout (update this section if it changes)

```
fincount/
  API.md                         app ↔ backend contract (change both sides together)
  app/                           Electron + React + Vite (TypeScript)
    src/main/index.ts            starts/stops backend, pickers, save dialogs
    src/preload/index.ts         window.desktop bridge
    src/shared/api.ts            API types (mirror backend schemas)
    src/shared/survey.ts         display helpers only (no counting logic)
    src/renderer/src/
      api.ts                     every backend call
      ui.tsx                     shared UI pieces (Chip, Modal, Field, buttons…)
      components/                VideoPlayer, PointTimeline, PointPanel, UnknownGallery,
                                 LabelCanvas, LabelPicker, NewSpeciesForm, TrendsChart…
                                 (today: SuggestionButtons, ReferencePictures, UseAsReference, MatchAgainButton,
                                 ProtocolResults, VideoResultCard, PointTable, PointEditor, ImageResultsTable,
                                 EvaluationPanel, UnknownGallery, LabelPicker, LabelCanvas,
                                 Splash + OceanScene: start-up animation shown until the back end is ready;
                                 ReefScene, SeaFloor, Critters, SurveyCamera: its "reef" look, used at start-up;
                                 the plainer "classic" look is still available via Splash's `variant`)
      views/                     Upload, Processing, Results, ImageResults, Label, QC,
                                 Trends, Species, Settings, People
                                 (today: Report shows the protocol results; Label is the Label page)
    test/                        Vitest
  backend/
    fincount_api/                main.py (routes), schemas.py, db.py, jobs (pipeline.py today)
    aquavision/
      config.py                  load and validate config/*.yaml into config objects
      ingest.py                  classify files, join chapter files, read Transect/STAT from paths
      archive.py                 safe ZIP extraction (see Adding media)
      frames.py                  read frames from local video (OpenCV) for a time range
      clips.py                   save each point's context clip (FFmpeg, OpenCV fallback)
      protocol.py                analysis window, subsample timestamps, context ranges
      detect.py                  fish + invertebrate detector (interim: Community Fish Detector RF-DETR;
                                 target: YOLOX; Grounding DINO fallback)
      species.py                 BioCLIP on crops, registry matching, novelty distance
      track.py                   ByteTrack wrapper
      analyse.py                 one file: window → points (context clips, tracking) → richness scan → species
      results.py                 survey results from stored rows: points, MeanCount, richness, image counts
      device.py                  GPU/CPU choice at start-up; one lock for all GPU work
      fetch_models.py            developer tool: put pinned, checksummed weights into models/ (never at runtime)
      count.py                   tolerance-window counting, MeanCount, richness, image counts
      clarity.py                 clarity index per frame/point/video; suggested visibility; pole bands (P2)
      trends.py                  per-video summaries for the Trends page
      labels.py                  apply/undo labels on tracks, recalculate counts, reference images
      qc.py                      blind QC sampling and agreement stats
      evaluate.py                AI vs hand counts, protocol-style (per-point % diff, share within 6%, MeanCount)
      export.py                  rows for the Coastal Action spreadsheet (written by ExcelJS in the app)
      benchmark.py               timing, VRAM, RAM, frames/s
    config/protocol.yaml         protocol parameters (defaults)
    config/app.yaml              app settings (accepted types, limits, ffmpeg path, thresholds)
    models/                      local weights (git-ignored)
    tests/                       pytest; media fixtures generated at test time
docs/LICENCES.md                 licence register
UI_Wireframes.pdf                screen reference (see UI reference)
```

Components move from `views/` into `components/` as screens are reworked.

## UI reference

`UI_Wireframes.pdf` is the screen reference. Build on the FinCount shell (sidebar, who's working,
light/dark theme, shortcuts sheet, export check) and add the missing wireframe screens on top.

- Where FinCount and the wireframe differ, **the wireframe wins for protocol features**: analysis
  window confirm, subsample point timeline and panel, video player with ±0.5 s loop, label gallery
  and picker, QC on points with the context clip, image grid, benchmark.
- **FinCount wins for look and feel:** colours, layout details, and fonts **Sora** (display) and
  **Manrope** (body), bundled with `@fontsource`. Ignore the wireframe's mention of Inter.
- The product name shown everywhere is **TIDE** (the wireframes say AquaVision AI).
- **Remove from FinCount:** invasive/unusual alerts and stat tiles, MaxN as the headline count,
  "Unidentified fish" (use "Unknown/Unable to ID due to visibility"), and protocol settings kept
  only in `localStorage`.

## Adding media

### Accepted input (lists live in `config/app.yaml`)

| Type | Extensions (default) | How it is processed |
|---|---|---|
| Video | `.mp4`, `.mov`, `.avi`, `.mkv` | Full protocol: window, subsample points, MeanCount |
| Image | `.jpg`, `.jpeg`, `.png`, `.tif`, `.tiff` | Single-frame detection, species and counts |
| Archive | `.zip` containing any mix of the above | Extracted, then each file handled by type |

- One set of added files (any mix of files, folders and ZIPs) becomes one **survey**. "Survey"
  is the word in the UI and API; it means the same as "batch" elsewhere in this file.
- Unsupported files are skipped and listed with the reason; they never fail the whole survey.
- Ignore system files: `__MACOSX/`, `.DS_Store`, `Thumbs.db`, hidden files.
- Keep relative folder paths from ZIPs and dropped folders. `ingest.py` uses them to read
  Transect / STAT / Video ID (for example `T1/STAT 1/GX010021.MP4`).
- Electron's `expand()` (in `src/main/index.ts`) must accept the same types as `config/app.yaml`,
  including `.tif`, `.tiff` and `.zip`.

### Images are not videos

- Images get per-image fish, invertebrate and species counts. They **do not** get subsample points
  and are **never** included in MeanCount.
- Image results go in their own table and their own spreadsheet sheet ("Images").
- If a ZIP contains frames that clearly come from one video (for example numbered sequences), treat
  them as images anyway unless the user marks them otherwise. Do not guess timestamps.

### Large files (read in place)

- RUV videos can be several GB. Electron passes **full local paths** to the backend, which reads
  videos and images **in place** (including from the external drive) and never copies them.
  There is no chunked upload.
- Only ZIPs are extracted, into `<data folder>/surveys/<survey_id>/extracted/`. Before extracting,
  check free disk space and the ZIP limits in `config/app.yaml`, and stop with a clear message if
  they are exceeded.
- Show progress per file and for the whole survey.
- If a file disappears before processing (drive unplugged), mark that file failed and continue.

### Safe ZIP extraction (`archive.py`)

- Reject entries with absolute paths or `..` (path traversal / "zip slip").
- Enforce limits from `config/app.yaml`: total uncompressed size, file count, and compression
  ratio (zip-bomb guard).
- Extract only into `<data folder>/surveys/<survey_id>/extracted/`. Never execute or import
  extracted files.
- Nested ZIPs: not supported in the prototype; list them as skipped.
- Stream extraction; do not load whole archives into memory.

## Protocol rules the code must implement

| Rule | Default | Config key |
|---|---|---|
| Discard start and end of video | 60 s each | `window.trim_start_s`, `window.trim_end_s` |
| Extra settling time allowed if sediment persists | up to 240 s (human confirms) | `window.max_extra_settle_s` |
| Sediment check: settled below this score (frame change ÷ contrast) | 0.6 (placeholder, calibrate on real footage) | `window.settle_threshold` |
| Sediment check: frames read per second / time it must stay settled | 2 fps / 10 s | `window.settle_scan_fps`, `window.settle_hold_s` |
| Analysis window length | 15 min | `window.length_s` |
| Subsample interval | every 60 s → 15 points | `subsample.interval_s` |
| One analyzed unit | 1 second | `subsample.unit_s` |
| Context viewed around each point | ±5 s (may become ±10 s) | `subsample.context_s` |
| Count tolerance around the point | ±0.5 s, never more than ±1 s | `count.tolerance_s`, `count.max_tolerance_s` |
| QC sample | random ≥10% of points per video | `qc.sample_fraction` |
| QC pass threshold | <6% difference between counts | `qc.max_pct_diff` |
| Re-annotation trigger | agreement <95% | `qc.min_agreement` |
| Visibility categories | `<0.5`, `0.5–1.0`, `1.0–1.5`, `>1.5` m | `visibility.categories` |
| Offset of point 1 from the window start | 0 s (to be confirmed with Coastal Action) | `subsample.first_point_offset_s` |
| Full-window scan rate for species richness | 2 frames per second | `richness.scan_fps` |

- **Analysis window:** `propose_window()` proposes it during processing (a later start if sediment
  hasn't settled) and stores it in the `videos` table. It is **never applied without a person**:
  subsample points and the richness scan only accept an `AnalysisWindow` confirmed via
  `PATCH /videos/{id}`. Videos shorter than trim + window + trim are flagged `too_short` and can't
  be confirmed or processed.
- Each survey stores a snapshot of the protocol values it was processed with. Changes in Settings
  apply to new processing only; old results keep their values.
- Only the frames needed are decoded: each point's ±`context_s` range and the full-window scan at
  `richness.scan_fps`. Frames stay in memory; only each point's context clip is saved to disk.

Counting logic:

- Count an organism at a point only if it is visible within the tolerance window around that point.
- Use tracking across the context clip so one fish is counted **once** (no double counting).
- The context clip is for finding fish (for example, camouflaged flounder that only show when moving).
  Fish seen only outside the tolerance window are **not** counted; they become a note.
- **MeanCount** = sum of per-point counts ÷ number of points. Keep zero-count points in the mean.
- **Species richness** = number of distinct species seen anywhere in the analysis window
  (from a sparse full-window scan, not only the subsample points).
- Count fish and invertebrates (crabs, shrimp, worms, snails) separately.
- Species the classifier cannot identify go to `Unknown/Unable to ID due to visibility`.
- An organism far from every registry species is a **Potential Novel Sighting** for expert review.
  Never label anything "invasive" automatically.
- MaxN is an optional extra only. Do not make it the headline metric.

## Clarity index (measured during detection)

A camera cannot measure turbidity (NTU); that needs a turbidity meter. The app measures a
**clarity index**: a 0–100 estimate of how clear the water looks in the video.

- **Name:** always "Clarity index" in code, UI and exports (not "Water clarity", which FinCount
  uses today). Never call it turbidity or show NTU unless it has been calibrated against real
  turbidity-meter or Secchi readings (roadmap).
- **Computed on the same frames used for detection** (no second pass over the video, no extra AI
  model), with OpenCV + NumPy. Inputs, each normalised to 0–1 and combined with weights from
  `config/app.yaml` (`clarity.weights`):
  - contrast (RMS contrast)
  - sharpness (edge strength, e.g. variance of the Laplacian)
  - haze level (e.g. dark-channel estimate)
  - colour shift (red-channel loss vs. green/blue)
  - suspended particles (small bright specks)
- **Pole bands (P2):** when the 2 m visibility pole is present, estimate visible distance from how
  many 0.5 m bands are clear. Prefer this over the image-based score when available.
- **Outputs:** one clarity index per subsample point (median of the frames in its tolerance
  window), plus per video: median, min, max, and trend (improving / worsening / stable).
- **Suggested visibility category** (`visibility.categories`) from the clarity index, using
  thresholds in `config/app.yaml` (`clarity.category_thresholds`), calibrated on frames where staff
  recorded a category. Staff confirm or change it; the confirmed value is what gets exported.
- **Visibility changes:** flag a point when the suggested category changes from the previous point
  (the protocol asks staff to note changes of 0.5 m or more).
- **Low clarity** (below `clarity.review_threshold`) sets `needs_review` and adds a
  "low visibility" note. It never adds or removes counts by itself.
- **Export:** clarity index and suggested category as extra columns after Coastal Action's
  template columns; never overwrite their visibility column with an unconfirmed value.
- Light, depth and camera auto-exposure affect the score. Do not compare videos as if the index
  were absolute; the Trends page shows it as an estimate.

## Trends page (line graphs per video)

After each video is processed, it adds one point to two **line graphs** stacked on the same time axis:

1. **Clarity index** (0–100) per video (video median).
2. **Species found** per video (species richness for that video's analysis window).

Rules:

- **X-axis:** videos in recording-date order. Read the date from the folder path (e.g.
  `Fall 2025/August 20_2025/T1/STAT 1/...`) or file metadata; the user can correct it. Videos
  without a date are listed separately, not plotted at a guessed date.
- Label points with date, Transect and STAT. Tooltip: clarity index, suggested/confirmed
  visibility category, species found, MeanCount, review status.
- Keep the two charts stacked with the same x-axis so a drop in species can be checked against a
  drop in clarity.
- **Filters:** Transect, STAT, date range. **Reviewed-only by default**, with a toggle to include
  AI-only results. A toggle groups by survey date (mean with min–max range and number of videos).
- Clicking a point opens that video's results.
- Images are not plotted (they have no MeanCount or analysis window).
- **History import (P2):** past completed spreadsheets can be imported so species counts start with
  real history; clarity only exists where the video was processed. Imported points are marked as
  imported.
- Chart library: **Recharts** (MIT), already used by FinCount and bundled by Vite (offline).
- Data comes from `GET /trends`; the chart component does no calculations of its own.
- FinCount's current Trends screen differs and must change: one point per **video** (not per
  survey), filters by **Transect/STAT** (not site), "Reviewed only" **on** by default, a
  "Group by survey date" toggle, the second chart fixed to species found (no invasive metric), and
  the video **median** clarity index (not the mean).

## Labelling unknown fish (after processing)

After a batch is processed, the user can label every fish the AI left as **Unknown/Unable to ID
due to visibility** or **Potential Novel Sighting**, in videos and images.

### What the user sees (Label page)

- A gallery of unlabelled fish, grouped **one card per tracked fish** (not per frame), across all
  videos and images in the batch. Filters: video / image, Transect, STAT, label status.
- Each card shows: the best crop, the source (Video ID + point number + timestamp, or image path),
  the AI's top 3 suggestions with scores, and the reason it is unknown (low confidence or novelty).
- Clicking a card opens the context clip at that moment (or the full image) with the box drawn.
- Counts of remaining unknowns are always visible, per video and for the batch.

### Labelling actions

| Action | Effect |
|---|---|
| Draw a new box around a fish or invertebrate the AI missed | Adds it to the count only if the frame is inside the tolerance window of a subsample point (or on an image); otherwise saved as a note and training example |
| Resize or move an AI box | Corrects the box; label and count unchanged |
| Delete a false box (algae, sediment, bubbles) | Removes it from all counts |
| Pick a species (suggestion button or dropdown, see Label picker) | Moves the fish from `unknown` to that species column |
| Add a new species | Creates a registry entry (name, optional scientific name) and labels the fish; asks for confirmation first |
| Keep as "Unable to ID due to visibility" | Marks it reviewed; stays in the unknown column |
| Not a fish / not an organism | Removes it from all counts (for example algae or bubbles) |
| Invertebrate | Moves it from fish to the invertebrate count (with type if known) |

The Label page replaces FinCount's one-picture-at-a-time "Check the fish" species list.

### Label picker (`LabelPicker.tsx`)

Labels are **chosen, never typed**. Every label must match a registry species or one of the fixed
options, so it maps to a spreadsheet column ("Cunner", "cunner" and "Cuner" must never become three
species). Never add a free-text label field.

The picker has three parts, top to bottom:

1. **Suggestion buttons:** the AI's top 3 guesses with scores (from `SpeciesResult.top_k`),
   e.g. `Cunner 0.62`. One click applies the label.
2. **Grouped dropdown:** a native `<select>` with `<optgroup>` sections:
   - **Fish species:** all registry species, alphabetical, shown as common name + scientific name.
   - **Invertebrates:** `crab`, `shrimp`, `worm`, `snail`.
   - **Other:** "Unable to ID due to visibility" and "Not a fish / not an organism".
   Starts on a disabled "Choose a label…" option so nothing is picked by accident.
   Option values encode the action, e.g. `species:Cunner`, `invertebrate:crab`, `unidentifiable`,
   `not_organism`, and map one-to-one to `FishLabel.action`.
3. **"Add new species…"** link below the dropdown. It opens `NewSpeciesForm.tsx` (name, optional
   scientific name, confirmation step), creates the registry entry via `POST /species`, then
   applies the label.

Behaviour:

- Pin the 2–3 most recently used species at the top of the Fish species group (per user,
  remembered in `localStorage`; it is only a convenience).
- Keyboard: `1`, `2`, `3` pick the suggestion buttons; `Enter` confirms; the dropdown stays fully
  keyboard-accessible.
- Hovering a species shows a small reference image from the registry, if one exists.
- With several cards selected, one choice labels them all (bulk labelling).
- The picker never calls the backend itself: it calls an `onChoose(label)` prop and the parent
  sends it through `src/renderer/src/api.ts`.
- Prototype uses the native `<select>` (no extra library). A searchable dropdown is a roadmap item
  for when the registry grows past ~20 species; ask the team before adding a library for it.

### Labelling canvas

- The labelling canvas shows the full frame with AI boxes and lets the user step to the previous /
  next frame (camouflaged organisms often show only when moving).
- A drawn box that overlaps an existing track (IoU above `label.match_iou` in `config/app.yaml`)
  relabels that track instead of adding a new organism, so nothing is counted twice.
- Drawn and corrected boxes can be exported locally in COCO format as YOLOX training data
  (subject to the no-data-leakage rule below).
- Select several cards and apply one label to all of them (bulk labelling).
- A label applies to the whole track, so every frame of that fish gets the same label.
- Every label is reversible (undo), and labelling never blocks export. The export shows how many
  unknowns remain.

### Rules

- **Keep the original AI result.** Store the AI label and scores next to the human label, with who
  labelled it and when. Never overwrite the AI's output.
- **Recalculate after every change:** per-point species counts, `unknown`, `species_observed`,
  species richness and image counts. Relabelling between species does not change `total_fish`,
  so MeanCount stays the same; "Not a fish" and "Invertebrate" do change it.
- **Human labels are the final value** in the spreadsheet; AI values stay available for evaluation.
- **Never label anything "invasive" automatically.** A user may record that judgement in Notes.
- **Reference images:** the user can tick "Use as reference image" so the labelled crop is added to
  that species in the registry. This improves future identification without retraining.
- **No data leakage:** labels from Coastal Action's test videos must not become training data or
  reference images used when evaluating those same videos. Mark test-set batches and disable
  "Use as reference image" for them.
- **Export labelled crops (optional):** a local export of labelled crops in a standard folder
  structure, for future fine-tuning. Stays on the local machine like all other media.

## API (fincount/backend/fincount_api/main.py)

`fincount/API.md` is the contract between the app and the backend: change both sides in the same
commit (backend `schemas.py` + `main.py`; app `src/shared/api.ts` + `src/renderer/src/api.ts`).

- Address `http://127.0.0.1:<port>`; every request sends `X-FinCount-Token` (or `?token=` for
  `<img>`/`<video>` URLs). No `/api` prefix.
- **JSON is camelCase.** Python stays snake_case; Pydantic converts.
- Errors are `{"detail": "plain-English message"}`, shown to staff as-is.

| Status | Method and path | Purpose |
|---|---|---|
| Keep | `GET /health` · `GET /model` · `GET /storage` | Start-up check; model and mode (`device: "gpu" \| "cpu"`); disk use |
| Keep | `GET /people` · `POST /people` · `DELETE /people/{name}` | Who's working |
| Keep, extend | `GET/POST /species` · `PATCH/DELETE /species/{id}` | Registry; add reference images. Status is a human note only |
| Change | `POST /analyses` | Start processing a survey: details + local file paths; extracts ZIPs, runs ingest → `Job` |
| Keep, extend | `GET /analyses/{jobId}` · `POST /analyses/{jobId}/cancel` | Status, %, per-video pipeline step, errors |
| Keep | `GET /surveys` · `GET/PATCH/DELETE /surveys/{id}` | Surveys (= batches) |
| New | `GET /surveys/{id}/results` | Videos with per-point counts, MeanCount, richness; image counts |
| Done (US-2.1) | `GET /surveys/{id}/videos` | Each video's proposed window, flags (`tooShort`, `settled`) and confirmed window |
| Done (US-2.1) | `PATCH /videos/{id}` | Confirm analysis window (`windowStartS`, `windowEndS`); person from the `X-FinCount-User` header (URL-encoded, must be on the people list). Later: recording date, visibility |
| New | `PATCH /points/{id}` | Review edit; keeps the original AI value |
| New | `GET /media/{fileId}` | Stream a video or image (HTTP range requests so the player can seek) |
| New | `GET /points/{id}/clip` | The saved ±context clip for a point |
| New | `GET /surveys/{id}/unknowns` | Unlabelled fish grouped by track, with crop, source and top 3 suggestions |
| New | `POST /labels` · `DELETE /labels/{id}` | Apply a label to one or more tracks (returns updated counts); undo |
| Change | `GET /surveys/{id}/qc` · `POST /surveys/{id}/qc` | Blind QC on **points** (not pictures); returns absolute and % difference |
| New | `GET /trends` | Per-video summaries; query: `transect`, `stat`, `from`, `to`, `reviewedOnly`, `groupBySurvey` |
| New | `GET /settings/protocol` · `PUT /settings/protocol` | Read/write protocol settings (applies to new processing) |
| New | `POST /benchmark` · `GET /benchmark` | Run and read the hardware benchmark |
| New (optional) | `GET /surveys/{id}/labelled-crops.zip` | Local export of labelled crops |
| Retire | `GET /frames/{id}/image` · `PATCH /detections/{id}` | Replaced by media, points and labels |

**Export:** the app writes the `.xlsx` with ExcelJS (`exportXlsx.ts`), using only rows from
`GET /surveys/{id}/results` (no calculations in the renderer). Sheets: video sheet (Coastal Action
template columns, then clarity columns), **Images** (renamed from FinCount's "Pictures"), and
**Read me** (open items; file marked "Draft" when any remain).

### Module interfaces (Python)

Keep these shapes stable so team members can work in parallel. Change them only with team agreement.
API responses mirror them in camelCase (via Pydantic in `schemas.py`).

```python
# ingest.py
@dataclass
class MediaItem:
    file_id: str
    batch_id: str
    kind: str              # "video" | "image" | "skipped"
    rel_path: str          # path inside the upload/ZIP, e.g. "T1/STAT 1/GX010021.MP4"
    video_id: str | None   # joined chapter files share one video_id
    transect: str | None
    stat: str | None
    recorded_at: datetime | None   # from folder path or file metadata; user-correctable
    skip_reason: str | None

# protocol.py
@dataclass
class SubsamplePoint:
    video_id: str
    point_no: int          # 1..N
    timestamp_s: float     # time of the point within the video
    clip_path: Path        # context clip (point ± context_s)

# frames.py: every frame carries its source; frames stay in memory
class Frame(NamedTuple):
    video_id: str
    frame_idx: int
    t_s: float             # decoder-reported timestamp in seconds
    image: np.ndarray

# detect.py
@dataclass
class Detection:
    frame_idx: int         # 0 for images
    t_s: float             # 0.0 for images
    box: tuple[float, float, float, float]   # x1, y1, x2, y2 in pixels
    cls: str               # "fish" | "invertebrate:<type>"
    conf: float
    track_id: str | None   # same fish across frames; None for images (one track per detection)

# species.py
@dataclass
class SpeciesResult:
    top_k: list[tuple[str, float]]   # (species name, score)
    novelty: float                   # distance to nearest registry species
    label: str                       # species name | "Unknown" | "Potential Novel Sighting"

# count.py: one row per subsample point, mirrors the spreadsheet
@dataclass
class PointCount:
    video_id: str
    point_no: int
    timestamp_s: float
    total_fish: int
    invertebrates: int
    per_species: dict[str, int]
    unknown: int
    species_observed: int
    visibility: str | None          # confirmed category (staff)
    clarity_index: float | None     # 0–100, median over the tolerance window
    suggested_visibility: str | None
    notes: str
    needs_review: bool

# trends.py: one point on the Trends line graphs
@dataclass
class VideoSummary:
    video_id: str
    recorded_at: datetime | None
    transect: str | None
    stat: str | None
    species_found: int              # species richness for the analysis window
    mean_count: float
    clarity_index: float | None     # video median
    clarity_min: float | None
    clarity_max: float | None
    clarity_trend: str | None       # "improving" | "worsening" | "stable"
    visibility: str | None          # confirmed or suggested category
    reviewed: bool
    imported: bool                  # True for history imported from past spreadsheets

# count.py: one row per image (never part of MeanCount)
@dataclass
class ImageCount:
    file_id: str
    rel_path: str
    total_fish: int
    invertebrates: int
    per_species: dict[str, int]
    unknown: int
    notes: str
    needs_review: bool

# labels.py: a human label on one tracked fish (AI result is never overwritten)
@dataclass
class FishLabel:
    label_id: str
    batch_id: str
    track_id: str
    action: str            # "species" | "unidentifiable" | "not_organism" | "invertebrate"
    box: tuple[float, float, float, float] | None   # set when the user drew or corrected the box
    box_source: str        # "ai" | "ai_corrected" | "human_drawn"
    frame_idx: int | None  # frame the human box was drawn on
    species: str | None    # registry name when action == "species"
    invertebrate_type: str | None
    ai_label: str          # what the AI said ("Unknown" | "Potential Novel Sighting")
    ai_top_k: list[tuple[str, float]]
    use_as_reference: bool
    labelled_by: str
    labelled_at: datetime
```

## Models

| Role | First choice | Fallback | Licence |
|---|---|---|---|
| Detection | YOLOX-m on PyTorch CUDA (GPU) | YOLOX-s via ONNX Runtime (CPU); Grounding DINO (zero-shot) | Apache 2.0 |
| Species ID | BioCLIP 2.5 Huge on PyTorch CUDA | BioCLIP 2, small custom classifier (PyTorch CPU) | MIT |
| Tracking | ByteTrack | box-overlap matching | MIT |

FinCount's `README.md` ("run the model with onnxruntime, not PyTorch") and `pipeline.py`
("decode YOLO boxes … for YOLOv8/11") are out of date: the runtime is PyTorch CUDA and the
detector is YOLOX. Update them when the detector is wired in.

### YOLO (YOLOX) rules

- The detector is **YOLOX** (Megvii, Apache 2.0). Do not add Ultralytics YOLO (YOLOv8/YOLO11):
  it is AGPL-3.0 and could force the whole project under that licence.
- **Fine-tuning is required.** COCO-pretrained YOLOX has no fish class. Fine-tune on labelled fish
  and invertebrate frames from a COCO-format dataset. Split by video (see Data and evaluation rules).
- **Classes:** `fish`, plus invertebrate classes (`crab`, `shrimp`, `worm`, `snail`) mapped to
  `Detection.cls` as `"invertebrate:<type>"`. Species are **not** detector classes; species ID stays
  in `species.py`.
- **Weights** ship in `models/yolox/` and load from disk only. Never download at runtime.
- **CPU path:** export YOLOX-s to ONNX and run with ONNX Runtime. Benchmark against PyTorch on CPU.
- Convert YOLOX output to our `Detection` dataclass inside `detect.py`; no other module depends on
  YOLOX types.
- **Confidence threshold** comes from `config/app.yaml` (`detect.conf_threshold`), tuned on a
  held-out video to stay conservative.
- Record the exact YOLOX version, model size and weight file in `docs/LICENCES.md`.

## Data and evaluation rules

- Split training, validation and test data **by video**, never by random frames.
  Consecutive frames are near-identical and random splits inflate accuracy.
- Coastal Action's past completed spreadsheets are the main test set. Never train on them.
- Evaluate the AI the way the protocol evaluates a human counter: per-point % difference vs. the
  human count, share of points within 6%, MeanCount difference per video, zero-point agreement.
  Always report absolute differences too (1 vs. 2 fish is 50%).
- Report measured numbers only. Show failure cases. Do not invent accuracy or time-saving figures.

## Commands

The venv must be at `fincount/backend/.venv` (the app looks for it there). Python 3.11, Node 22+.

```bash
# Backend (once). Windows: py -m venv .venv ; .venv\Scripts\Activate.ps1
cd fincount/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
pytest
uvicorn fincount_api.main:app --port 8765 --reload    # optional: the app reuses it

# App
cd fincount/app
npm install
npm run dev            # opens TIDE and starts the backend from backend/.venv
npm test               # Vitest
npm run typecheck

# Benchmark
python -m aquavision.benchmark --video <path to a local video>

# Windows installer (on Windows, or GitHub Actions "Build Windows installer")
cd fincount/backend && pyinstaller fincount-api.spec --noconfirm
cd ../app && npm run dist:win
```

The commands above are for developers. Coastal Action staff only use the installer.

Before calling a task done: run `pytest`, `npm test` and `npm run typecheck`, then run the app once
with the network disabled (add a video, an image and a ZIP; confirm a window; review a point; draw
and label one unknown fish; check the export updates). Before a release, install on a clean Windows
machine with the network disabled.

## Coding conventions

### Python (backend and pipeline)

- Python 3.11, type hints, dataclasses for data passed between modules.
- Read all settings from `config/*.yaml`; pass config objects in, don't read globals.
- Route handlers stay thin: validate input, call `aquavision`, return JSON.
- Each module must be testable alone. Generate media fixtures at test time (for example a short
  synthetic video written with OpenCV into `tmp_path`); never commit media.
- Models load once at startup and are cached; never reload per frame or per request.
- Run species ID only on detection crops, never on whole frames.
- Log, don't crash, on a bad file; mark it in the batch and continue.
- Short docstrings that name the protocol rule a function implements.

### TypeScript (app)

Some team members are new to JavaScript. Optimize the app code for readability:

- TypeScript, kept simple: types for API shapes (`src/shared/api.ts`); avoid clever generics.
  Function components and hooks only; no class components.
- Keep components small (roughly under 150 lines). One component per file. Split `Review.tsx`
  and `Report.tsx` as they are reworked.
- Every backend call goes in `src/renderer/src/api.ts`; every Electron call goes through
  `window.desktop`. Components never call `fetch` directly.
- Prefer `useState` and `useEffect`; do not add Redux or other state libraries.
- No protocol calculations in the renderer (see Architecture).
- Styling: Tailwind classes plus the shared pieces in `ui.tsx`. Fonts Sora/Manrope via
  `@fontsource`. Status chips always use an icon plus text, never colour alone.
- Add a short comment above any non-obvious hook or effect explaining what it does and why. When
  you change app code, explain the change in plain language in your reply.
- Drag and drop: native drop with `window.desktop.pathsOf()` (no `react-dropzone`). Keep the
  "Choose files" and "Choose a folder" buttons for keyboard and accessibility.
- Show clear states for every file: waiting, processing (with %), done, skipped (with reason),
  failed (with detail).
- Draw detection boxes on a `<canvas>` layered over the `<video>` or `<img>`; never re-encode
  video in the app.
- Ask before adding any new npm dependency, and check its licence.

## Open questions (do not guess; use config defaults until answered)

- Final protocol values: 15 vs. 60 points, 5 vs. 10 s context, 12 vs. 15 min window.
- Exact spreadsheet template columns (map them in `export.py` once received).
- Target species list (3–5 for the prototype).
- Camera resolution, frame rate, and chapter-file naming.
- Whether invertebrates are counted as one total or by type.
- What Coastal Action wants from image uploads (still photos from surveys? frames exported from video?).
- Typical ZIP sizes, to set the extraction limits in `config/app.yaml`.
- Where point 1 sits in the analysis window (`subsample.first_point_offset_s`: at the window
  start, or mid-interval?).
- Does the PyTorch CUDA installer fit the NSIS size limit, or must the backend ship as a separate
  folder?
- Whether cloud GPUs may be used for training only.
- Who may add new species to the registry (any user, or a designated reviewer)?
- Should user labels later be used to fine-tune the species model, and who approves that?
- Do they take turbidity-meter or Secchi readings at deployment (needed to calibrate the clarity
  index)? Are camera exposure settings fixed? Which videos include the visibility pole?
