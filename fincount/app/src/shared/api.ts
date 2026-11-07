// Types shared by the screens and Electron. The HTTP API itself is described in ../../../API.md
// and implemented in backend/fincount_api/main.py; app/src/renderer/src/api.ts is the client.
import type { Detection, Frame, Species } from "./survey";

export type Sampling = 1 | 2 | 5; // pictures per second of video

export type AnalysisRequest = {
  site: string;
  surveyDate: string; // YYYY-MM-DD the footage was filmed ("" if unknown)
  person: string; // who started it
  environment: string;
  threshold: number; // 0–1
  sampling: Sampling;
  enhance: boolean; // clear up murky water
  ignoreSpecks: boolean; // drop tiny boxes (sediment, bubbles)
  files: string[]; // full paths on disk
};

export type FileStatus = {
  name: string;
  state: "waiting" | "working" | "done" | "failed" | "skipped";
  detail: string;
};

export type Job = {
  jobId: string;
  surveyId: number;
  state: "running" | "done" | "failed" | "cancelled";
  percent: number; // 0–100
  stage: number; // index into ANALYSIS_STAGES
  detail: string;
  error?: string | null;
  files: FileStatus[];
};

export type Progress = Pick<Job, "surveyId" | "percent" | "stage" | "detail" | "files">;

export const ANALYSIS_STAGES = [
  "Splitting video into pictures",
  "Clearing up murky water",
  "Finding fish",
  "Identifying species",
  "Writing the report",
] as const;

export type SurveyInfo = {
  id: number;
  site: string;
  environment: string;
  threshold: number;
  createdAt: string;
  surveyDate: string;
  createdBy: string;
  files: string[];
  frameCount: number;
  status: "running" | "done" | "failed" | "cancelled";
};

export type SurveyData = { survey: SurveyInfo; frames: Frame[] };

/** One video in a survey: the analysis window TIDE proposed, and the one a person confirmed. */
export type Video = {
  id: string;
  surveyId: number;
  fileName: string;
  durationS: number;
  fps: number;
  proposedStartS: number | null; // null when the video is too short for the protocol
  proposedEndS: number | null;
  proposedReason: string; // plain English, shown to staff
  settled: boolean | null; // false: sediment still unsettled at the latest allowed start
  tooShort: boolean; // flagged: can't be confirmed or processed
  settleScore: number | null;
  windowStartS: number | null; // confirmed by a person; null until then
  windowEndS: number | null;
  confirmedBy: string;
  confirmedAt: string;
};

export type ModelStatus = { ready: boolean; demo: boolean; name: string; message: string };

export type PickedFile = { path: string; name: string; size: number };
export type SkippedFile = { name: string; reason: string };

export type Person = { name: string; role: string };

export type QcCount = { frameId: string; person: string; fish: number; invertebrates: number; createdAt: string };
export type QcData = { sample: string[]; counts: QcCount[] };

export type Storage = {
  dataDir: string;
  freeBytes: number;
  totalBytes: number;
  picturesBytes: number;
  databaseBytes: number;
};

/** Where the back end is running. error is set if it couldn't start. */
export type BackendInfo = { url: string; token: string; error?: string };

/** What the screens can do. Implemented by app/src/renderer/src/api.ts. */
export type FinCountApi = {
  model: { status: () => Promise<ModelStatus> };
  storage: () => Promise<Storage>;
  people: {
    list: () => Promise<Person[]>;
    add: (p: Person) => Promise<Person[]>;
    remove: (name: string) => Promise<Person[]>;
  };
  species: {
    list: () => Promise<Species[]>;
    add: (s: Omit<Species, "id" | "custom" | "addedAt">) => Promise<Species[]>;
    update: (id: string, patch: Partial<Species>) => Promise<Species[]>;
    remove: (id: string) => Promise<Species[]>;
    reset: () => Promise<Species[]>;
  };
  analysis: {
    start: (req: AnalysisRequest) => Promise<{ surveyId: number; files: FileStatus[] }>; // resolves when finished
    cancel: () => Promise<void>;
    onProgress: (cb: (p: Progress) => void) => () => void;
  };
  surveys: {
    list: () => Promise<SurveyInfo[]>;
    get: (id: number) => Promise<SurveyData>;
    update: (id: number, patch: { site?: string; surveyDate?: string }) => Promise<void>;
    remove: (id: number) => Promise<void>;
    /** Each video's proposed and confirmed analysis window. */
    videos: (id: number) => Promise<Video[]>;
  };
  videos: {
    /** Confirm (or change) a video's analysis window, saved with the person's name. */
    confirmWindow: (id: string, startS: number, endS: number, person: string) => Promise<Video>;
  };
  detections: {
    update: (id: string, patch: Pick<Detection, "speciesId" | "verified"> & { by: string }) => Promise<void>;
  };
  qc: {
    get: (surveyId: number, percent: number) => Promise<QcData>;
    add: (surveyId: number, percent: number, c: Omit<QcCount, "createdAt">) => Promise<QcData>;
  };
};

/** The desktop-only bits Electron exposes as window.desktop (see app/src/preload/index.ts). */
export type DesktopApi = {
  backend: () => Promise<BackendInfo>;
  onBackendCrashed: (cb: (message: string) => void) => void;
  pickFiles: () => Promise<string[]>;
  pickFolder: () => Promise<string[]>;
  /** Real paths of files/folders dropped on the window. */
  pathsOf: (files: File[]) => string[];
  /** Expands folders and sorts paths into usable files and skipped ones (with a reason). */
  expand: (paths: string[]) => Promise<{ files: PickedFile[]; skipped: SkippedFile[] }>;
  saveXlsx: (suggestedName: string, data: ArrayBuffer) => Promise<string | null>;
  savePdf: (suggestedName: string) => Promise<string | null>;
  /** Taskbar progress (0–1), or null to clear it. */
  setProgress: (fraction: number | null) => void;
  openPath: (path: string) => void;
};
