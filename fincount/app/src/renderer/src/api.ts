// Client for the TIDE back end (FastAPI, running on this computer).
// Every screen goes through `api` — the endpoints are documented in API.md at the repo root.
import type {
  BackendInfo,
  FinCountApi,
  Job,
  Progress,
  QcData,
  Reference,
  SurveyData,
  SurveyResults,
  Unknowns,
} from "../../shared/api";

let backend: BackendInfo = { url: "", token: "" };

/** Called once at start-up (see main.tsx). Resolves when the back end is ready. */
export async function connect(): Promise<BackendInfo> {
  backend = await window.desktop.backend();
  return backend;
}

export class ApiError extends Error {}

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(backend.url + path, {
      method,
      headers: { "X-FinCount-Token": backend.token, ...(body !== undefined && { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("TIDE's back end isn't responding. Try closing and reopening the app.");
  }
  if (!res.ok) {
    const detail = await res
      .json()
      .then((j: { detail?: unknown }) => j.detail)
      .catch(() => res.statusText);
    throw new ApiError(
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? String((detail[0] as { msg?: string })?.msg ?? "Something was filled in wrong.")
          : JSON.stringify(detail),
    );
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const progressListeners = new Set<(p: Progress) => void>();
let currentJob: string | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;
// <img> can't send headers, so picture URLs carry the token in the query instead.
const imageUrl = (path: string) => `${backend.url}${path}${backend.token ? `?token=${backend.token}` : ""}`;
const withImages = (refs: Reference[]) => refs.map((r) => ({ ...r, image: imageUrl(r.image) }));

export const api: FinCountApi = {
  model: { status: () => http("GET", "/model") },
  storage: () => http("GET", "/storage"),

  people: {
    list: () => http("GET", "/people"),
    add: (p) => http("POST", "/people", p),
    remove: (name) => http("DELETE", `/people/${enc(name)}`),
  },

  species: {
    list: () => http("GET", "/species"),
    add: (s) => http("POST", "/species", s),
    update: (id, patch) => http("PATCH", `/species/${enc(id)}`, patch),
    remove: (id) => http("DELETE", `/species/${enc(id)}`),
    reset: () => http("POST", "/species/reset"),
    references: {
      list: async (speciesId) => withImages(await http("GET", `/species/${enc(speciesId)}/references`)),
      add: async (speciesId, paths, by) =>
        withImages(await http("POST", `/species/${enc(speciesId)}/references`, { paths, by })),
      fromDetection: async (speciesId, detectionId, by) =>
        withImages(
          await http("POST", `/species/${enc(speciesId)}/references/from-detection`, { detectionId, by }),
        ),
      remove: (referenceId) => http("DELETE", `/references/${enc(referenceId)}`),
    },
  },

  analysis: {
    // Starts the job, then checks its progress twice a second until it finishes.
    async start(req) {
      let job = await http<Job>("POST", "/analyses", req);
      currentJob = job.jobId;
      try {
        while (job.state === "running") {
          progressListeners.forEach((cb) => cb(job));
          await sleep(500);
          job = await http<Job>("GET", `/analyses/${job.jobId}`);
        }
      } finally {
        currentJob = null;
      }
      if (job.state === "cancelled") throw new ApiError("cancelled");
      if (job.state === "failed") throw new ApiError(job.error ?? "The analysis failed.");
      progressListeners.forEach((cb) => cb(job));
      return { surveyId: job.surveyId, files: job.files };
    },
    cancel: async () => {
      if (currentJob) await http("POST", `/analyses/${currentJob}/cancel`);
    },
    onProgress: (cb) => {
      progressListeners.add(cb);
      return () => progressListeners.delete(cb);
    },
  },

  surveys: {
    list: () => http("GET", "/surveys"),
    async get(id) {
      const data = await http<SurveyData>("GET", `/surveys/${id}`);
      // Picture URLs come back as paths; <img> can't send headers, so the token goes in the query.
      const q = backend.token ? `?token=${backend.token}` : "";
      return { ...data, frames: data.frames.map((f) => ({ ...f, image: `${backend.url}${f.image}${q}` })) };
    },
    update: (id, patch) => http("PATCH", `/surveys/${id}`, patch),
    remove: (id) => http("DELETE", `/surveys/${id}`),
    reidentify: (id) => http("POST", `/surveys/${id}/reidentify`),
    async results(id) {
      const r = await http<SurveyResults>("GET", `/surveys/${id}/results`);
      return {
        ...r,
        videos: r.videos.map((v) => ({
          ...v,
          points: v.points.map((p) => ({ ...p, clip: p.clip ? imageUrl(p.clip) : null })),
        })),
      };
    },
    async unknowns(id) {
      const r = await http<Unknowns>("GET", `/surveys/${id}/unknowns`);
      return { ...r, fish: r.fish.map((f) => ({ ...f, crop: imageUrl(f.crop) })) };
    },
    evaluate: (id, csvPath) => http("POST", `/surveys/${id}/evaluation`, { path: csvPath ?? null }),
  },
  videos: { update: (id, patch) => http("PATCH", `/videos/${id}`, patch) },
  points: { update: (id, patch) => http("PATCH", `/points/${id}`, patch) },
  labels: {
    add: (req) => http("POST", "/labels", req),
    undo: (labelId) => http("DELETE", `/labels/${enc(labelId)}`),
  },
  frames: { imageUrl: (frameId) => imageUrl(`/frames/${enc(frameId)}/image`) },

  detections: { update: (id, patch) => http("PATCH", `/detections/${id}`, patch) },

  qc: {
    get: (surveyId, percent) => http<QcData>("GET", `/surveys/${surveyId}/qc?percent=${percent}`),
    add: (surveyId, percent, c) => http<QcData>("POST", `/surveys/${surveyId}/qc?percent=${percent}`, c),
  },
};
