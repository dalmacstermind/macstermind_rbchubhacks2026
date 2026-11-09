// Types shared by the screens and Electron. The HTTP API itself is described in ../../../API.md
// and implemented in backend/tide_api/main.py; app/src/renderer/src/api.ts is the client.
import type { Detection, Frame, Species } from "./survey";

export type Sampling = 1 | 2 | 5; // pictures per second of video

export type AnalysisRequest = {
  site: string;
  surveyDate: string; // YYYY-MM-DD the footage was filmed ("" if unknown)
  person: string; // who started it
  threshold: number; // 0–1
  sampling: Sampling;
  enhance: boolean; // clear up murky water
  ignoreSpecks: boolean; // drop tiny boxes (sediment, bubbles)
  lookCloser: boolean; // also search the full-size picture in tiles: more small fish, slower
  tracker?: "bytetrack" | "ocsort"; // how fish are followed between pictures (default: settings)
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
  "Opening your files and checking each video's analysis window",
  "Clearing up murky photos",
  "Looking for fish in photos",
  "Identifying species in photos",
  "Saving the survey",
] as const;

export type SurveyInfo = {
  id: number;
  site: string;
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
  /** Videos whose analysis window no person has confirmed yet: nothing of them is counted. */
  windowsToConfirm: number;
  /** Videos with no finished count yet (waiting, counting, stopped or failed). */
  videosToCount: number;
  /** Of those, videos waiting in the queue or being counted right now. */
  videosCounting: number;
};

/** One point on the Trends graphs: one counted video. */
export type TrendPoint = {
  videoId: number;
  surveyId: number;
  surveySite: string;
  fileName: string;
  label: string;
  recordedAt: string;
  transect: string;
  stat: string;
  speciesFound: number;
  meanCount: number | null;
  clarityIndex: number | null; // video median
  clarityMin: number | null;
  clarityMax: number | null;
  clarityTrend: string | null;
  visibility: string | null; // confirmed or suggested category
  reviewed: boolean;
  shortWindow: boolean; // not comparable with full windows
  imported: boolean;
};

/** All the plotted videos of one date (Group by survey date). */
export type TrendGroup = {
  label: string;
  recordedAt: string;
  videos: number;
  clarityMean: number | null;
  clarityMin: number | null;
  clarityMax: number | null;
  speciesMean: number;
  speciesMin: number;
  speciesMax: number;
  meanCount: number | null;
};

/** A video that isn't on the Trends graphs; `explanation` is shown to staff as-is. */
export type NotPlottedVideo = {
  videoId: number;
  surveyId: number;
  surveySite: string;
  fileName: string;
  transect: string;
  stat: string;
  recordedAt: string;
  reason: string; // "too_short" | "not_confirmed" | "counting" | "not_counted" | "no_date" | "not_reviewed"
  explanation: string;
};

export type Trends = {
  points: TrendPoint[];
  groups: TrendGroup[];
  notPlotted: NotPlottedVideo[];
  transects: string[];
  stats: string[];
};

export type TrendsQuery = {
  transect: string;
  stat: string;
  from: string; // YYYY-MM-DD
  to: string;
  reviewedOnly: boolean;
  groupBySurvey: boolean;
};

/** How one video's count is going (GET /counts). */
export type CountStatus = {
  videoId: number;
  surveyId: number;
  site: string;
  fileName: string;
  state: "queued" | "running" | "done" | "failed" | "stopped";
  detail: string;
  percent: number | null; // 0–100 while running
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
  references?: number; // reference pictures in the Species Registry
};

/** A reference picture of a species. The species model compares fish with these. */
export type Reference = {
  id: string;
  speciesId: string;
  image: string; // full URL (the token is added by api.ts)
  source: string; // short description: the file name, or e.g. "GX010021.MP4 at 00:06:00"
  addedBy: string;
  addedAt: string;
  // Where it came from (empty for pictures uploaded from this computer, and for older pictures):
  surveyId: number | null;
  surveySite: string; // the survey's site name, if the survey still exists
  sourceFile: string; // the video or picture the fish was seen in
  sourceTime: string; // time in the video, e.g. "00:06:00"
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
  stationary: number; // objects that didn't move (pole markings, rocks, a resting fish?): not counted
  drifting: number; // moved exactly like the water (debris?): not counted until a person confirms
  unidentifiable: number; // seen only in pictures too murky to identify fish: not counted
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
  shortWindow: boolean; // shorter than the protocol window: counts not comparable with full windows
  confirmedBy: string;
  // "" = waiting for a confirmed window; "stopped" = a person stopped it, or TIDE closed while counting
  countState: "" | "queued" | "running" | "done" | "failed" | "stopped";
  countDetail: string; // what counting is doing now ("Identifying the species"), or why it stopped or failed
  countPercent: number | null; // 0–100 while running
  countEtaS: number | null; // estimated seconds left while running (null: not known yet)
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
  /** true: chosen by staff; false: suggested from the clarity index. */
  visibilityConfirmed: boolean;
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

export type ReportSpecies = {
  speciesId: string;
  common: string;
  scientific: string;
  totalAtPoints: number;
  pointsSeen: number;
  inImages: number;
  seenBetweenPoints: boolean;
  humanApproved: boolean;
  picture: string | null;
  referencePicture: string | null;
};

/** GET /surveys/{id}/report. Every number is worked out by the back end. */
export type SurveyReport = {
  results: SurveyResults;
  files: { name: string; sizeBytes: number | null }[];
  isSampleData: boolean;
  identifiedSpecies: number;
  aiOnly: number;
  humanApproved: number;
  nativeNoted: number;
  invasiveNoted: number;
  unusualNoted: number;
  statusNotNoted: number;
  unidentifiedFish: number;
  invertebrates: number;
  pointsTotal: number;
  species: ReportSpecies[];
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
  points: {
    video: string;
    pointNo: number;
    ai: number;
    human: number;
    absDiff: number;
    pctDiff: number;
    within: boolean;
  }[];
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
  shortWindow?: boolean; // shorter than the protocol window (protocol.yaml window.allow_short_videos)
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
export type TideApi = {
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
      /** Remove one picture of this species; saved with the person's name. Returns the pictures left. */
      remove: (speciesId: string, referenceId: string, person: string) => Promise<Reference[]>;
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
    update: (id: number, patch: { site?: string; surveyDate?: string; threshold?: number }) => Promise<void>;
    remove: (id: number) => Promise<void>;
    /** Match the survey's fish again against the current reference pictures. */
    reidentify: (id: number) => Promise<Reidentified>;
    results: (id: number) => Promise<SurveyResults>;
    report: (id: number) => Promise<SurveyReport>;
    unknowns: (id: number) => Promise<Unknowns>;
    /** Compare the AI's point counts with hand counts: a CSV file, or (no path) the points staff reviewed. */
    evaluate: (id: number, csvPath?: string) => Promise<Evaluation>;
    /** Each video's proposed and confirmed analysis window. */
    videos: (id: number) => Promise<Video[]>;
  };
  trends: {
    /** One point per counted video, and every other video with the reason it isn't plotted. */
    get: (query: TrendsQuery) => Promise<Trends>;
  };
  counts: {
    /** How every video's count is going. */
    list: () => Promise<CountStatus[]>;
  };
  videos: {
    /** Confirm (or change) a video's analysis window, saved with the person's name. */
    confirmWindow: (id: string, startS: number, endS: number, person: string) => Promise<Video>;
    /** Count the confirmed window again (after counting was stopped, failed or interrupted). */
    startCount: (id: number, person: string) => Promise<void>;
    /** Stop counting; nothing of the stopped count is kept. */
    stopCount: (id: number, person: string) => Promise<void>;
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
  /** Taskbar progress (0–1), above 1 for a moving "busy" bar, or null to clear it. */
  setProgress: (fraction: number | null) => void;
  /** Tells Electron how many videos are being counted, so closing TIDE can warn first. */
  setCounting: (videos: number) => void;
  /** Brings TIDE's window to the front (restoring it if it's minimized). */
  focusWindow: () => void;
  openPath: (path: string) => void;
};
