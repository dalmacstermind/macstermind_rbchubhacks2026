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
  /** The protocol values this survey was processed with (the shipped defaults if they weren't recorded). */
  protocol: ProtocolSettings;
  /** false for surveys processed before TIDE recorded the values: then `protocol` is the shipped defaults. */
  protocolRecorded: boolean;
};

export type SurveyData = { survey: SurveyInfo; frames: Frame[] };

/** Protocol values on the Settings screen. Times in seconds, QC in percent. */
export type ProtocolSettings = {
  trimStartS: number;
  trimEndS: number;
  maxExtraSettleS: number;
  lengthS: number; // analysis window
  intervalS: number; // one subsample point every intervalS
  firstPointOffsetS: number;
  contextS: number; // ± seconds around each point
  toleranceS: number; // ± seconds counted around each point
  maxToleranceS: number; // the protocol's limit for toleranceS (shown, not changed)
  qcSamplePct: number;
  qcMaxDiffPct: number;
  qcAgreementPct: number;
  pointsPerWindow: number | null; // worked out by the back end
};

export type ProtocolSettingsState = {
  values: ProtocolSettings; // what new processing will use
  defaults: ProtocolSettings; // the shipped config/protocol.yaml
  source: "default" | "custom";
  changedBy: string;
  changedAt: string;
  warning: string;
};

/** Settings checked without saving: points per window, or a plain-English problem per field. */
export type ProtocolCheck = { pointsPerWindow: number | null; errors: Partial<Record<keyof ProtocolSettings, string>> };

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

// ── Protocol results (subsample points, MeanCount, species richness). Calculated by the back end. ──

export type PointResult = {
  id: number;
  pointNo: number;
  timestampS: number;
  totalFish: number; // final: a person's value if they changed it, else the AI's
  invertebrates: number;
  perSpecies: Record<string, number>; // species id → count
  unknown: number; // "Unknown/Unable to ID due to visibility"
  speciesObserved: number;
  clarityIndex: number | null; // 0–100 estimate (not turbidity)
  suggestedVisibility: string | null;
  visibility: string | null; // confirmed by staff (only this is exported as visibility)
  notes: string; // the AI's notes
  staffNotes: string;
  needsReview: boolean;
  reviewed: boolean;
  editedBy: string;
  uncertain: number;
  outside: number;
  ai: { totalFish: number; invertebrates: number }; // the AI's counts, never changed
  clip: string | null; // full URL of the ±context clip (token added by api.ts)
};

export type VideoResult = {
  id: number;
  name: string;
  recordedAt: string;
  transect: string;
  stat: string;
  windowStartS: number | null; // confirmed by a person; nothing is counted until then
  windowEndS: number | null;
  proposedStartS: number | null; // what TIDE proposed (see Video)
  proposedEndS: number | null;
  proposedReason: string;
  settled: boolean | null;
  tooShort: boolean; // flagged: not processed
  confirmedBy: string;
  countState: "" | "queued" | "running" | "done" | "failed"; // "" = waiting for a confirmed window
  countDetail: string;
  points: PointResult[];
  meanCount: number | null;
  meanCountAi: number | null;
  speciesRichness: number;
  speciesFound: string[];
  clarityIndex: number | null; // video median
  clarityMin: number | null;
  clarityMax: number | null;
  clarityTrend: "improving" | "worsening" | "stable" | null;
  visibility: string | null;
  reviewed: boolean;
  unknownsRemaining: number;
};

export type ImageResult = {
  fileId: string;
  relPath: string;
  totalFish: number;
  invertebrates: number;
  perSpecies: Record<string, number>;
  unknown: number;
  notes: string;
  needsReview: boolean;
};

export type SurveyResults = {
  videos: VideoResult[];
  images: ImageResult[];
  unknownsRemaining: number;
  visibilityCategories: string[];
};

export type PointPatch = {
  totalFish?: number; // -1 = back to the AI's value
  invertebrates?: number;
  visibility?: string;
  notes?: string;
  by: string;
};

/** Recording details (the window itself is confirmed with videos.confirmWindow). */
export type VideoDetailsPatch = {
  recordedAt?: string;
  transect?: string;
  stat?: string;
  visibility?: string;
};

// ── Labelling unknown fish ──

export type LabelAction = "species" | "unidentifiable" | "not_organism" | "invertebrate";
export type InvertebrateType = "crab" | "shrimp" | "worm" | "snail";

export type FishLabelInfo = {
  id: string;
  action: LabelAction;
  species: string | null;
  invertebrateType: InvertebrateType | null;
  labelledBy: string;
  labelledAt: string;
};

export type UnknownFish = {
  trackId: string;
  crop: string; // full URL of the best crop
  source: {
    kind: "video" | "image";
    file: string;
    videoId: number | null;
    pointNo: number | null;
    timestamp: string;
    role: "point" | "scan" | "photo";
  };
  frameIds: string[]; // pictures this organism appears in, in time order
  bestFrameId: string;
  box: { x: number; y: number; w: number; h: number };
  aiLabel: string; // "Unknown" | "Potential Novel Sighting"
  suggestions: { speciesId: string; score: number }[];
  reason: string;
  label: FishLabelInfo | null;
};

export type Unknowns = { fish: UnknownFish[]; remaining: number; remainingByFile: Record<string, number> };

/** What the label picker chooses: always a registry species or a fixed option, never typed text. */
export type LabelChoice = { action: LabelAction; species?: string; invertebrateType?: InvertebrateType };

export type LabelRequest = LabelChoice & {
  surveyId: number;
  trackIds?: string[];
  useAsReference?: boolean;
  frameId?: string; // with box: a box drawn around an organism the AI missed
  box?: { x: number; y: number; w: number; h: number };
  by: string;
};

// ── Evaluation: the AI against hand counts ──

export type Evaluation = {
  pointsCompared: number;
  shareWithin: number | null; // 0–1
  meanAbsDiff: number | null;
  medianPctDiff: number | null;
  zeroAgreement: number | null;
  meetsAgreement: boolean | null;
  maxPctDiff: number;
  minAgreement: number;
  videos: {
    video: string;
    points: number;
    meanCountAi: number;
    meanCountHuman: number;
    meanCountAbsDiff: number;
    meanCountPctDiff: number;
    shareWithin: number;
    zeroAgreement: number;
  }[];
  points: { video: string; pointNo: number; ai: number; human: number; absDiff: number; pctDiff: number; within: boolean }[];
  unmatchedHuman: string[];
  source: string;
};

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
    results: (id: number) => Promise<SurveyResults>;
    unknowns: (id: number) => Promise<Unknowns>;
    /** Compare the AI's point counts with hand counts: a CSV file, or (no path) the points staff reviewed. */
    evaluate: (id: number, csvPath?: string) => Promise<Evaluation>;
    /** Each video's proposed and confirmed analysis window. */
    videos: (id: number) => Promise<Video[]>;
  };
  videos: {
    /** Confirm (or change) a video's analysis window, saved with the person's name. */
    confirmWindow: (id: string, startS: number, endS: number, person: string) => Promise<Video>;
    /** Correct the recording date, Transect or STAT, or confirm the video's visibility. */
    details: (id: number, patch: VideoDetailsPatch) => Promise<void>;
  };
  points: { update: (id: number, patch: PointPatch) => Promise<void> };
  labels: {
    add: (req: LabelRequest) => Promise<{ labelIds: string[]; remaining: number }>;
    undo: (labelId: string) => Promise<{ labelIds: string[]; remaining: number }>;
  };
  frames: { imageUrl: (frameId: string) => string };
  detections: {
    update: (id: string, patch: Pick<Detection, "speciesId" | "verified"> & { by: string }) => Promise<void>;
  };
  qc: {
    /** The sample size comes from the survey's protocol values (picked once, then kept). */
    get: (surveyId: number) => Promise<QcData>;
    add: (surveyId: number, c: Omit<QcCount, "createdAt">) => Promise<QcData>;
  };
  settings: {
    protocol: {
      get: () => Promise<ProtocolSettingsState>;
      /** Check values without saving (as staff type). */
      check: (s: ProtocolSettings) => Promise<ProtocolCheck>;
      /** Save for new processing; saved with the person's name. */
      save: (s: ProtocolSettings, person: string) => Promise<ProtocolSettingsState>;
      reset: (person: string) => Promise<ProtocolSettingsState>;
    };
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
  /** Pick one CSV file (hand counts), or null. */
  pickCsv: () => Promise<string | null>;
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
