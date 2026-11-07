# FinCount API contract

This is the agreement between the **app** (Electron + React) and the **back end** (FastAPI).
If you change something here, change both sides in the same commit:

- Back end: `backend/fincount_api/schemas.py` (shapes) and `main.py` (routes)
- App: `app/src/shared/api.ts` + `app/src/shared/survey.ts` (types) and `app/src/renderer/src/api.ts` (calls)

While the back end is running, the same API is browsable and testable at **http://127.0.0.1:8765/docs**.

## Basics

- **Address:** `http://127.0.0.1:<port>`. It's only reachable from this computer. In development the port is `8765`; the installed app picks a free port.
- **Token:** every request sends `X-FinCount-Token: <token>`. For `<img>` URLs it goes in the query instead: `?token=<token>`. In development there's no token, so it isn't checked.
- **JSON is camelCase** (`speciesId`, `createdAt`). The Python code uses snake_case; Pydantic converts between them.
- **Errors** come back as `{"detail": "plain-English message"}`. The app shows `detail` to staff as-is, so write it for a non-technical reader.
- **Boxes are percentages** (0–100) of the picture's width and height, measured from its top-left corner.

## Endpoints

### App

| Method | Path | Returns | Notes |
| --- | --- | --- | --- |
| GET | `/health` | `{status: "ok", version}` | The app waits for this at start-up |
| GET | `/model` | `ModelStatus` | `demo: true` makes the app show "Demo mode" |
| GET | `/storage` | `Storage` | Free disk space and what FinCount uses (Settings screen) |

### People (no passwords)

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/people` | | `Person[]` |
| POST | `/people` | `{name, role?}` | `Person[]`. Same name in any case updates the role |
| DELETE | `/people/{name}` | | `Person[]` |

### Species list

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/species` | | `Species[]` |
| POST | `/species` | `{common, scientific?, status?, habitat?, kind?, addedBy?}` | `Species[]` (the full updated list). `409` if the name already exists, ignoring case and spaces |
| PATCH | `/species/{id}` | any of `{common, scientific, status, habitat, kind}` | `Species[]` |
| DELETE | `/species/{id}` | | `Species[]`. Only species staff added (`custom: true`) can be removed |
| POST | `/species/reset` | | `Species[]` back to the original list |

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

### Blind QC

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/surveys/{id}/qc?percent=10` | | `QcData`. The random sample is picked the first time, then kept |
| POST | `/surveys/{id}/qc?percent=10` | `{frameId, person, fish, invertebrates}` | `QcData`. Counting the same picture again replaces your earlier count |

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
                    addedAt: string 
                }

AnalysisRequest{ 
                    site: string, surveyDate: string,  // "YYYY-MM-DD" filmed, or ""
                    person: string,                     // who started it
                    environment: string,
                    threshold: number,          // 0–1: below this, staff must check before it counts
                    sampling: 1 | 2 | 5,        // pictures per second of video
                    enhance: boolean,           // clear up murky water
                    ignoreSpecks: boolean,      // drop boxes smaller than 0.3% of the picture
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
                    environment: string, 
                    threshold: number, 
                    createdAt: string,
                    surveyDate: string, 
                    createdBy: string,
                    files: string[], 
                    frameCount: number, status: "running" | "done" | "failed" | "cancelled" 
                }

SurveyData     { survey: SurveyInfo, frames: Frame[] }

Frame          { 
                    id: string, 
                    image: string,              // path like "/frames/12/image"
                    source: string,             // original file name
                    timestamp: string,          // "00:01:47", or "Photo"
                    clarity: number | null,     // 0–100 water-clarity estimate (pipeline TODO 3), for Trends
                    detections: Detection[] 
                }

Detection      { 
                    id: string,
                    speciesId: string,          // a species id, "unknown", or "not_fish"
                    modelSpeciesId: string,     // what the model said; never changes, so staff can undo
                    confidence: number,         // 0–1
                    verified: boolean,          // a person confirmed or corrected it
                    editedBy: string,           // who
                    box: { x, y, w, h }        // percentages
                }       

ModelStatus    { 
                    ready: boolean, 
                    demo: boolean, 
                    name: string, 
                    message: string 
                }

Person         { name: string, role: string }

QcData         { 
                    sample: string[],           // frame ids picked for the recount
                    counts: { frameId, person, fish, invertebrates, createdAt }[] 
                }
                
Storage        { dataDir, freeBytes, totalBytes, picturesBytes, databaseBytes }
```

## Who decides what

- **The back end** finds fish and stores everything. It returns **every** detection with confidence ≥ 0.2, including unsure ones.
- **The app** applies the certainty threshold, works out the counts (MaxN: the most of each species seen in one picture), compares blind QC counts, and builds the Excel/PDF exports. So the back end never needs to calculate counts.
- **QC rules** (sample %, allowed difference, agreement target) are settings in the app, saved on the computer.
