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

export type ModelStatus = {
  ready: boolean;
  demo: boolean;
  name: string;
  message: string;
  device?: "gpu" | "cpu"; // shown as "GPU mode" / "CPU mode"
  gpu?: string; // graphics card name in GPU mode
  speciesModel?: string; // e.g. "BioCLIP 2", or "" when it isn't installed
  references?: number; // reference pictures in the species list
};

/** A reference picture of a species. The species model compares fish with these. */
export type Reference = {
  id: string;
  speciesId: string;
  image: string; // full URL (the token is added by api.ts)
  source: string; // original file name, or "Checked fish 12"
  addedBy: string;
  addedAt: string;
};

export type Reidentified = { tracks: number; changed: number };

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
    references: {
      list: (speciesId: string) => Promise<Reference[]>;
      /** Pictures on this computer (full paths), e.g. from window.desktop.pickImages(). */
      add: (speciesId: string, paths: string[], by: string) => Promise<Reference[]>;
      /** Use a checked fish's crop as a reference picture. */
      fromDetection: (speciesId: string, detectionId: string, by: string) => Promise<Reference[]>;
      remove: (referenceId: string) => Promise<void>;
    };
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
    /** Match the survey's fish again against the current reference pictures. */
    reidentify: (id: number) => Promise<Reidentified>;
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
  /** Pick pictures (not videos), e.g. reference pictures of a species. */
  pickImages: () => Promise<string[]>;
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
