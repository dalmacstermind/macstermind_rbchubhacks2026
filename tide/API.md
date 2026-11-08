# TIDE API contract

This is the agreement between the **app** (Electron + React) and the **back end** (FastAPI).
If you change something here, change both sides in the same commit:

- Back end: `backend/tide_api/schemas.py` (shapes) and `main.py` (routes)
- App: `app/src/shared/api.ts` + `app/src/shared/survey.ts` (types) and `app/src/renderer/src/api.ts` (calls)

While the back end is running, the same API is browsable and testable at **http://127.0.0.1:8765/docs**.

## Basics

- **Address:** `http://127.0.0.1:<port>`. It's only reachable from this computer. In development the port is `8765`; the installed app picks a free port.
- **Token:** every request sends `X-TIDE-Token: <token>`. For `<img>` URLs it goes in the query instead: `?token=<token>`. In development there's no token, so it isn't checked.
- **JSON is camelCase** (`speciesId`, `createdAt`). The Python code uses snake_case; Pydantic converts between them.
- **Errors** come back as `{"detail": "plain-English message"}`. The app shows `detail` to staff as-is, so write it for a non-technical reader.
- **Boxes are percentages** (0–100) of the picture's width and height, measured from its top-left corner.

## Endpoints

### App

| Method | Path | Returns | Notes |
| --- | --- | --- | --- |
| GET | `/health` | `{status: "ok", version}` | The app waits for this at start-up |
| GET | `/model` | `ModelStatus` | `demo: true` makes the app show "Demo mode" |
| GET | `/storage` | `Storage` | Free disk space and what TIDE uses (Settings screen) |

### People (no passwords)

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/people` | | `Person[]` |
| POST | `/people` | `{name, role?}` | `Person[]`. Same name in any case updates the role |
| DELETE | `/people/{name}` | | `Person[]` |

### Species Registry

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/species` | | `Species[]` |
| POST | `/species` | `{common, scientific?, status?, habitat?, kind?, addedBy?}` | `Species[]` (the full updated list). `409` if the name already exists, ignoring case and spaces |
| PATCH | `/species/{id}` | any of `{common, scientific, status, habitat, kind}` | `Species[]` |
| DELETE | `/species/{id}` | | `Species[]`. Only species staff added (`custom: true`) can be removed |
| POST | `/species/reset` | | `Species[]` back to the original list |

### Species reference pictures (species identification)

The species model (BioCLIP 2) compares every fish with these pictures. A species with no reference
pictures can't be suggested. Pictures are read from this computer (full paths, like `/analyses`).

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/species/{id}/references` | | `Reference[]` |
| POST | `/species/{id}/references` | `{paths: string[], by?}` | `Reference[]`. `400` if a file is missing or not a picture; `503` if the species model isn't installed |
| POST | `/species/{id}/references/from-detection` | `{detectionId, by?}` | `Reference[]`. Uses a checked fish's crop |
| DELETE | `/species/{id}/references/{refId}` | header `X-TIDE-User: <URL-encoded name>` | `Reference[]` left for that species. `400` if the person is missing or not on the people list; `404` if the picture isn't this species'. Recorded with who and when |
| DELETE | `/references/{refId}` | | `204`. Older route without a person or species check; kept working, not used by the app |
| GET | `/references/{refId}/image` | | the JPG (token in the query, like frame pictures) |

### Analysis (runs in the background)

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/analyses` | `AnalysisRequest` | `202` + `Job`. `409` if one is already running; `400` if a file is missing |
| GET | `/analyses/{jobId}` | | `Job`. The app checks this every 0.5 s |
| POST | `/analyses/{jobId}/cancel` | | `204`. The survey is discarded |

### Surveys and staff checks

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/surveys` | | `SurveyInfo[]`, finished surveys only, newest first |
| GET | `/surveys/{id}` | | `SurveyData` |
| PATCH | `/surveys/{id}` | `{site?, surveyDate?}` | `204`. Used to add a missing filming date |
| DELETE | `/surveys/{id}` | | `204`. Also deletes its pictures |
| GET | `/frames/{frameId}/image` | | the JPG/PNG picture |
| PATCH | `/detections/{id}` | `{speciesId, verified, by}` | `204`. Saved the moment staff click; `by` is who did it |
| POST | `/surveys/{id}/reidentify` | | `{tracks, changed}`. Matches the survey's fish again against the current reference pictures (no new detection). Boxes staff checked keep their species |

### Protocol results (subsample points, MeanCount, species richness)

Nothing is counted until a person confirms the video's analysis window (`PATCH /videos/{id}`, below):
confirming starts the point counting in the background (`countState` in the results), and confirming
a different window counts again from scratch. Videos too short for the protocol are flagged, not counted.
Counting can be stopped (`POST /videos/{id}/count/stop`) and started again on the same confirmed window
(`POST /videos/{id}/count`). Nothing of a stopped count is saved. A count that was waiting or running
when TIDE closed is marked `stopped` at the next start-up (it can't carry on), with a plain-English
`countDetail`. `SurveyInfo.windowsToConfirm` says how many videos still wait for a person,
`videosToCount` how many have no finished count yet, and `videosCounting` how many of those are waiting
in the queue or being counted. `GET /counts` lists every video queued for counting, across all surveys,
with its `state` (`queued`, `running`, `done`, `failed`, `stopped`) and a plain-English `detail`
(while running: the percentage and, once it can be estimated, the time left).

Videos are analysed per the FFH protocol (`config/protocol.yaml`): confirmed window, a point every
`subsample.interval_s`, each point's ±`context_s` clip tracked so one fish counts once, counted only
within ±`count.tolerance_s`, plus a sparse full-window scan for species richness. Images get per-image
counts and are never in MeanCount. **All counting happens in the back end**; results are recalculated
on every request, so labels and point edits show up at once.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/surveys/{id}/results` | | `SurveyResults` |
| PATCH | `/videos/{id}/details` | `{recordedAt?, transect?, stat?, visibility?}` | `204`. Recording details; the window itself is confirmed with `PATCH /videos/{id}` below |
| POST | `/videos/{id}/count` | header `X-TIDE-User` | `204`. Count the confirmed window again (after it was stopped, failed or interrupted). `400` no person; `404`; `409` already counting; `422` window not confirmed |
| POST | `/videos/{id}/count/stop` | header `X-TIDE-User` | `204`. Stop counting (a waiting count stops at once, a running one at its next picture); `countDetail` becomes "Counting stopped by <name>". `400` no person; `404`; `409` not counting |
| PATCH | `/points/{id}` | `{totalFish?, invertebrates?, visibility?, notes?, by}` | `204`. Stored next to the AI's values; `-1` puts a count back to the AI's |
| GET | `/points/{id}/clip` | | the ±context clip (MP4; token in the query) |

### Labelling unknown fish (Label page)

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/surveys/{id}/unknowns` | | `Unknowns`: one card per tracked organism the AI left as Unknown / Potential Novel Sighting |
| GET | `/surveys/{id}/tracks/{trackId}/crop` | | the organism's best crop (JPG) |
| POST | `/labels` | `LabelRequest` | `{labelIds, remaining}`. One or more tracks (bulk), or a box drawn on a picture |
| DELETE | `/labels/{id}` | | `{labelIds: [], remaining}`. Undo: the pictures go back to what they said before |

A drawn box that overlaps an existing organism by `label.match_iou` relabels it instead of adding one.
Labels are chosen, never typed: `species` must be a registry id; `invertebrateType` one of crab, shrimp,
worm, snail.

### Evaluation (the AI against hand counts)

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/surveys/{id}/evaluation` | `{path?}` | `Evaluation`. `path`: a CSV of hand counts on this computer (`video, point, total_fish`); no path: the points staff reviewed |

### Videos and analysis windows

The window is proposed while a survey is processed (a later start if sediment hasn't settled) and is
**never used until a person confirms it**. Rules come from `backend/config/protocol.yaml`.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/surveys/{id}/videos` | | `Video[]`. `404` if the survey doesn't exist |
| GET | `/counts` | | `CountStatus[]`: `{videoId, surveyId, site, fileName, state, detail}` |
| PATCH | `/videos/{id}` | `{windowStartS, windowEndS}` + header `X-TIDE-User: <URL-encoded name>` | `Video`. `400` if the person is missing or not on the people list; `404` no such video; `422` with a plain-English reason if the times break the protocol or the video is too short |

Times are checked against the protocol: start no earlier than the trim (60 s), no later than the trim
plus extra settling time (300 s), exactly the window length (900 s, one frame either way), and ending
before the last 60 s of the video.

Videos shorter than trim + window + trim (17 min) get a **shorter window** over the usable clip
(`shortWindow: true`, `window.allow_short_videos: true` in `protocol.yaml`, the default): any part of the
video, at most 15 min, still confirmed by a person, and flagged as not comparable with full windows.
Its points are spread across the clip, about `subsample.short_window_interval_s` (2 s) apart, each in the
middle of its slice, and never more than a full window has (15).
With `allow_short_videos: false` they are flagged `tooShort` and not processed.

### Blind QC

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/surveys/{id}/qc` | | `QcData`. The random sample is picked the first time, then kept. Its size comes from the survey's protocol values (`qcSamplePct`); `?percent=` overrides it |
| POST | `/surveys/{id}/qc` | `{frameId, person, fish, invertebrates}` | `QcData`. Counting the same picture again replaces your earlier count |

### Protocol settings (Settings screen)

Defaults ship in `backend/config/protocol.yaml`; staff changes are saved to `protocol.yaml` in the data
folder. Changes apply to **new processing only**: each survey keeps the values it was processed with
(`SurveyInfo.protocol`).

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/settings/protocol` | | `ProtocolSettingsState` |
| PUT | `/settings/protocol?check=true` | `ProtocolSettings` | `ProtocolCheck`: nothing is saved. `pointsPerWindow`, or `errors` (field → plain-English reason) |
| PUT | `/settings/protocol` | `ProtocolSettings` + header `X-TIDE-User: <URL-encoded name>` | `ProtocolSettingsState`. `400` if the person is missing or not on the people list; `422` with the first problem if a value breaks a rule |
| DELETE | `/settings/protocol` | header `X-TIDE-User` | `ProtocolSettingsState`, back to the shipped defaults |

Rules checked: every time ≥ 0 (window length and interval > 0); count tolerance ≤ the protocol's ±1 s
limit; context ≥ tolerance; interval ≤ window length; first-point offset < interval; QC sample
1–100%, maximum difference 0–100%, agreement target 50–100%.

## Shapes

```ts
Species        {
                    id: string,
                    common: string,
                    scientific: string,
                    status: "native" | "invasive" | "unusual",
                    habitat: string,
                    kind: "fish" | "invertebrate",  // invertebrates (e.g. crabs) are counted separately
                    custom: boolean,
                    addedBy: string,
                    addedAt: string,
                    referenceCount: number,     // reference pictures the species model uses (0 = can't be suggested)
                    thumbnail: string | null    // path of the first reference picture (Species Registry card)
                }

Reference      {
                    id: string, speciesId: string,
                    image: string,              // path like "/references/3/image"
                    source: string,             // short note: the file name, or e.g. "GX010021.MP4 at 00:06:00"
                    addedBy: string, addedAt: string,
                    // where it came from; empty for uploaded pictures and pictures added before this was recorded:
                    surveyId: number | null, surveySite: string,
                    sourceFile: string,         // the video or picture the fish was seen in
                    sourceTime: string          // time in the video, e.g. "00:06:00"
                }

AnalysisRequest{
                    site: string, surveyDate: string,  // "YYYY-MM-DD" filmed, or ""
                    person: string,                     // who started it
                    threshold: number,          // 0–1: below this, staff must check before it counts
                    sampling: 1 | 2 | 5,        // pictures per second of video
                    enhance: boolean,           // clear up murky water
                    ignoreSpecks: boolean,      // drop boxes smaller than detect.speck_max_area_pct (app.yaml, 0.01 %) of the picture
                    lookCloser: boolean,        // also search the full-size picture in tiles: more small fish, ~5× slower
                    tracker?: "bytetrack" | "ocsort",   // how fish are followed between pictures (default: app.yaml)
                    files: string[]            // full paths on this computer (the app sends paths, not uploads)
                }

Job            {
                    jobId: string,
                    surveyId: number,
                    state: "running" | "done" | "failed" | "cancelled",
                    percent: number,            // 0–100
                    stage: number,              // 0 splitting, 1 clearing up water, 2 finding fish,
                                             // 3 identifying species, 4 writing report
                    detail: string,             // shown under the progress bar, e.g. "clip.mp4: 12 possible fish so far"
                    error: string | null,       // plain English, shown to staff when state = "failed"
                    files: { name, state: "waiting" | "working" | "done" | "failed" | "skipped", detail }[]
                }
                // one bad file never stops the batch; **detail** says why

SurveyInfo     {
                    id: number,
                    site: string,
                    threshold: number,
                    createdAt: string,
                    surveyDate: string,
                    createdBy: string,
                    files: string[],
                    frameCount: number, status: "running" | "done" | "failed" | "cancelled",
                    protocol: ProtocolSettings,     // the values this survey was processed with
                    protocolRecorded: boolean,      // false: processed before these were recorded (defaults shown)
                    windowsToConfirm: number,       // videos whose analysis window no person has confirmed (nothing counted)
                    videosToCount: number,          // videos with no finished count yet
                    videosCounting: number          // of those, waiting in the queue or being counted now
                }

ProtocolSettings      { trimStartS, trimEndS, maxExtraSettleS, lengthS, intervalS, firstPointOffsetS,
                        contextS, toleranceS, maxToleranceS, qcSamplePct, qcMaxDiffPct, qcAgreementPct: number,
                        pointsPerWindow: number | null }   // seconds and percent; maxToleranceS and
                                                           // pointsPerWindow are ignored when saving
ProtocolSettingsState { values: ProtocolSettings, defaults: ProtocolSettings, source: "default" | "custom",
                        changedBy: string, changedAt: string, warning: string }
ProtocolCheck         { pointsPerWindow: number | null, errors: { [field]: string } }

SurveyData     { survey: SurveyInfo, frames: Frame[] }
Video          { id: string, surveyId: number, fileName: string, durationS: number, fps: number,
                 proposedStartS: number | null, proposedEndS: number | null, proposedReason: string,
                 settled: boolean | null, tooShort: boolean, settleScore: number | null,
                 windowStartS: number | null, windowEndS: number | null,   // null until a person confirms
                 confirmedBy: string, confirmedAt: string,
                 shortWindow: boolean }          // shorter than the protocol window (not comparable)

Frame          {
                    id: string,
                    image: string,              // path like "/frames/12/image"
                    source: string,             // original file name
                    timestamp: string,          // "00:01:47", or "Photo"
                    clarity: number | null,     // 0–100 water-clarity estimate (pipeline TODO 3), for Trends
                    quality: "clear" | "moderate" | "muddy" | "obscured",   // per-picture filter; obscured = can't identify fish
                    qualityReasons: string,     // e.g. "blurred, hazy or turbid"
                    static: boolean,            // same as the previous picture: detector not run again, boxes carried over
                    detections: Detection[]
                }

Detection      {
                    id: string,
                    speciesId: string,          // a species id, "unknown", or "not_fish"
                    modelSpeciesId: string,     // what the model said; never changes, so staff can undo
                    confidence: number,         // 0–1
                    verified: boolean,          // a person confirmed or corrected it
                    editedBy: string,           // who
                    box: { x, y, w, h },       // percentages
                    // Real pipeline only (empty/absent in demo mode):
                    trackId: string,            // the same fish across pictures of one video shares a trackId
                    aiLabel: string,            // species id, "Unknown" or "Potential Novel Sighting"
                    suggestions: { speciesId, score }[],  // top guesses, best first; score = similarity 0–1, not a probability
                    novelty: number | null,     // 0–1 distance to the nearest species with reference pictures
                    unknownReason: string,      // plain English, when the AI couldn't name the species
                    possibleDrift: boolean      // moved exactly like the water: needs a person before it counts
                }       

ModelStatus    {
                    ready: boolean,
                    demo: boolean,              // true when the model files aren't installed: results are sample data
                    name: string,
                    message: string,
                    device: "gpu" | "cpu",      // shown as "GPU mode" / "CPU mode"
                    gpu: string,                // graphics card name in GPU mode
                    speciesModel: string,       // "BioCLIP 2", or "" when it isn't installed
                    references: number          // reference pictures in the Species Registry
                }

Person         { name: string, role: string }

QcData         {
                    sample: string[],           // frame ids picked for the recount
                    counts: { frameId, person, fish, invertebrates, createdAt }[]
                }

Storage        { dataDir, freeBytes, totalBytes, picturesBytes, databaseBytes }

SurveyResults  { videos: VideoResult[], images: ImageResult[], unknownsRemaining, visibilityCategories: string[] }

VideoResult    {
                    id, name, recordedAt, transect, stat,
                    windowStartS, windowEndS: number | null,   // confirmed by a person; null until then
                    proposedStartS, proposedEndS: number | null, proposedReason: string, settled: boolean | null,
                    tooShort: boolean,          // flagged: not processed (only when window.allow_short_videos is false)
                    shortWindow: boolean,       // shorter than the protocol window: counts not comparable with full windows
                    confirmedBy: string,
                    countState: "" | "queued" | "running" | "done" | "failed" | "stopped",  // "" = waiting for confirmation;
                                                // "stopped" = stopped by a person, or TIDE closed while counting
                    countDetail: string,
                    points: PointResult[],
                    meanCount: number | null,   // final (staff values where set); zero points included
                    meanCountAi: number | null, // the AI's alone
                    speciesRichness: number, speciesFound: string[],
                    clarityIndex, clarityMin, clarityMax: number | null,   // estimate, not turbidity
                    clarityTrend: "improving" | "worsening" | "stable" | null,
                    visibility: string | null, reviewed: boolean, unknownsRemaining: number
                }

PointResult    {
                    id, pointNo, timestampS,
                    totalFish, invertebrates,   // final
                    perSpecies: {speciesId: count}, unknown, speciesObserved,
                    clarityIndex, suggestedVisibility, visibility,   // visibility = confirmed by staff
                    notes, staffNotes, needsReview, reviewed, editedBy,
                    uncertain, outside,         // not counted: below the threshold / outside ±tolerance
                    stationary,                 // not counted: objects that never moved (pole markings, rocks, a resting fish?)
                    drifting,                   // not counted: tracks that moved exactly like the water (debris?)
                    unidentifiable,             // not counted: seen only in pictures too murky to identify fish
                    ai: { totalFish, invertebrates },   // never changed
                    clip: string | null         // "/points/3/clip"
                }

ImageResult    { fileId, relPath, totalFish, invertebrates, perSpecies, unknown, notes, needsReview }

Unknowns       { fish: UnknownFish[], remaining, remainingByFile: {file: count} }

UnknownFish    {
                    trackId, crop,              // "/surveys/1/tracks/f1-p1-t0/crop"
                    source: { kind: "video" | "image", file, videoId, pointNo, timestamp, role: "point" | "scan" | "photo" },
                    frameIds: string[], bestFrameId, box,
                    aiLabel, suggestions: {speciesId, score}[], reason,
                    label: { id, action, species, invertebrateType, labelledBy, labelledAt } | null
                }

LabelRequest   {
                    surveyId, action: "species" | "unidentifiable" | "not_organism" | "invertebrate",
                    trackIds?: string[], species?, invertebrateType?, useAsReference?,
                    frameId?, box?,             // a box drawn around an organism the AI missed
                    by
                }

Evaluation     {
                    pointsCompared, shareWithin, meanAbsDiff, medianPctDiff, zeroAgreement, meetsAgreement,
                    maxPctDiff, minAgreement,   // from protocol.yaml qc.*
                    videos: { video, points, meanCountAi, meanCountHuman, meanCountAbsDiff, meanCountPctDiff,
                              shareWithin, zeroAgreement }[],
                    points: { video, pointNo, ai, human, absDiff, pctDiff, within }[],
                    unmatchedHuman: string[], source
                }
```

## Who decides what

- **The back end** finds fish and stores everything. It returns **every** detection with confidence ≥ 0.2
  (`detect.conf_threshold` in `config/app.yaml`), including unsure ones. `confidence` is the fish
  detector's; the species model's result is in `aiLabel` / `suggestions`. A species is only filled in
  when the species model is sure (`species.match_threshold` and `species.margin`); otherwise
  `speciesId` is `"unknown"` and staff pick from the suggestions.
- **The back end** calculates the protocol figures (point counts, MeanCount, species richness, image
  counts, clarity) in `GET /surveys/{id}/results`. The app only shows them and writes them to Excel.
- **The app** still works out the picture-by-picture MaxN figures (an optional extra, not the headline),
  compares blind QC counts, and builds the Excel/PDF exports.
- **QC rules** (sample %, allowed difference, agreement target) are settings in the app, saved on the computer.
