// Shared between the main process (database, export) and the screens.
/**
 * native   – belongs in Nova Scotia waters
 * invasive – introduced species that harms native fish (should be reported)
 * unusual  – warm-water / out-of-range visitor (e.g. tropical strays arriving with warming water)
 */
export type SpeciesStatus = "native" | "invasive" | "unusual";

export type SpeciesKind = "fish" | "invertebrate";

export type Species = {
  id: string;
  common: string;
  scientific: string;
  status: SpeciesStatus;
  habitat: string;
  /** Invertebrates (e.g. crabs) are counted separately from fish. */
  kind?: SpeciesKind;
  /** true for species staff added themselves (they can be removed again) */
  custom?: boolean;
  addedBy?: string;
  addedAt?: string;
  /** Reference pictures the species model compares fish with (0 = it can't suggest this species). */
  referenceCount?: number;
};

export const DEFAULT_SPECIES: Species[] = [
  {
    id: "cod",
    common: "Atlantic cod",
    scientific: "Gadus morhua",
    status: "native",
    habitat: "Marine",
  },
  {
    id: "cunner",
    common: "Cunner",
    scientific: "Tautogolabrus adspersus",
    status: "native",
    habitat: "Marine",
  },
  {
    id: "mackerel",
    common: "Atlantic mackerel",
    scientific: "Scomber scombrus",
    status: "native",
    habitat: "Marine",
  },
  {
    id: "flounder",
    common: "Winter flounder",
    scientific: "Pseudopleuronectes americanus",
    status: "native",
    habitat: "Marine",
  },
  {
    id: "trout",
    common: "Brook trout",
    scientific: "Salvelinus fontinalis",
    status: "native",
    habitat: "Freshwater",
  },
  {
    id: "bass",
    common: "Smallmouth bass",
    scientific: "Micropterus dolomieu",
    status: "invasive",
    habitat: "Freshwater",
  },
  {
    id: "pickerel",
    common: "Chain pickerel",
    scientific: "Esox niger",
    status: "invasive",
    habitat: "Freshwater",
  },
  {
    id: "triggerfish",
    common: "Grey triggerfish",
    scientific: "Balistes capriscus",
    status: "unusual",
    habitat: "Marine",
  },
  {
    id: "green_crab",
    common: "European green crab",
    scientific: "Carcinus maenas",
    status: "invasive",
    habitat: "Marine",
    kind: "invertebrate",
  },
  { id: "unknown", common: "Unknown/Unable to ID due to visibility", scientific: "—", status: "native", habitat: "—" },
];

export const UNKNOWN = "unknown";
export const NOT_FISH = "not_fish";

export const STATUS_LABEL: Record<SpeciesStatus, string> = {
  native: "Native",
  invasive: "Invasive",
  unusual: "Unusual visitor",
};

export type Detection = {
  id: string;
  speciesId: string; // or NOT_FISH
  modelSpeciesId: string;
  confidence: number; // 0–1, how sure the model was
  verified: boolean; // a person confirmed or corrected it
  editedBy?: string; // who confirmed or corrected it
  box: { x: number; y: number; w: number; h: number }; // percentages of the frame
  /** Filled by the real pipeline (empty in demo mode). The same fish in several pictures shares a trackId. */
  trackId?: string;
  /** What the species model said: a species id, "Unknown" or "Potential Novel Sighting". */
  aiLabel?: string;
  /** The species model's top guesses, best first. Score is similarity 0–1, not a probability. */
  suggestions?: Suggestion[];
  /** 0–1 distance to the nearest species with reference pictures. */
  novelty?: number | null;
  /** Why the AI couldn't name the species, in plain English. */
  unknownReason?: string;
  /** Moved exactly like the water (debris or weed?): not counted until a person confirms. */
  possibleDrift?: boolean;
};

export type Frame = {
  id: string;
  image: string; // URL of the saved picture (served by the back end)
  source: string; // original file name
  timestamp: string;
  clarity?: number | null; // 0–100 water-clarity estimate (null = not measured)
  quality?: "" | "clear" | "moderate" | "muddy" | "obscured"; // obscured: too murky to identify fish
  qualityReasons?: string; // e.g. "blurred, hazy or turbid"
  static?: boolean; // same as the previous picture: the detector wasn't run again, its boxes were carried over
  detections: Detection[];
};

/** A detection needs a person to look at it when the model wasn't sure enough and nobody has checked it yet. */
export const needsReview = (det: Detection, threshold: number) =>
  !det.verified && det.speciesId !== NOT_FISH && det.confidence < threshold;

/** Counted = it's a fish, and either the model was sure enough or a person confirmed it. */
export const isCounted = (det: Detection, threshold: number) =>
  det.speciesId !== NOT_FISH && (det.verified || det.confidence >= threshold);

export type SpeciesRow = {
  sp: Species;
  maxN: number; // most individuals of this species seen in a single frame
  sightings: number; // every detection across all frames
  conf: number; // average model confidence
  corrected: number; // detections a person changed
};

/**
 * Builds the report. Fish are counted with MaxN — the highest number of a species visible
 * in any single frame. Adding up every frame would count the same fish again each time
 * it swims past the camera, so MaxN is the standard, conservative count for video surveys.
 */
export function summarize(frames: Frame[], species: Species[], threshold: number) {
  const byId = new Map(species.map((s) => [s.id, s]));
  const fallback = (id: string): Species =>
    byId.get(id) ?? {
      id,
      common: "Removed species",
      scientific: "—",
      status: "native",
      habitat: "—",
    };

  const all = frames.flatMap((f) => f.detections);
  const counted = all.filter((det) => isCounted(det, threshold));

  const rowsById = new Map<string, SpeciesRow & { confSum: number }>();
  for (const frame of frames) {
    const perFrame = new Map<string, number>();
    for (const det of frame.detections) {
      if (!isCounted(det, threshold)) continue;
      perFrame.set(det.speciesId, (perFrame.get(det.speciesId) ?? 0) + 1);
      const row = rowsById.get(det.speciesId) ?? {
        sp: fallback(det.speciesId),
        maxN: 0,
        sightings: 0,
        conf: 0,
        confSum: 0,
        corrected: 0,
      };
      row.sightings += 1;
      row.confSum += det.confidence;
      if (det.speciesId !== det.modelSpeciesId) row.corrected += 1;
      rowsById.set(det.speciesId, row);
    }
    for (const [id, n] of perFrame) {
      const row = rowsById.get(id)!;
      row.maxN = Math.max(row.maxN, n);
    }
  }

  const rows: SpeciesRow[] = Array.from(rowsById.values())
    .map(({ confSum, ...r }) => ({ ...r, conf: confSum / r.sightings }))
    .sort((a, b) => b.maxN - a.maxN || b.sightings - a.sightings);

  const isInvert = (r: SpeciesRow) => r.sp.kind === "invertebrate";
  const fishRows = rows.filter((r) => !isInvert(r));
  const sumMaxN = (status: SpeciesStatus) => rows.filter((r) => r.sp.status === status).reduce((a, r) => a + r.maxN, 0);
  const clarities = frames.map((f) => f.clarity).filter((c): c is number => typeof c === "number");

  return {
    /** Fish only (MaxN summed over species). Invertebrates are counted separately. */
    total: fishRows.reduce((a, r) => a + r.maxN, 0),
    invertebrates: rows.filter(isInvert).reduce((a, r) => a + r.maxN, 0),
    sightings: counted.filter((d) => byId.get(d.speciesId)?.kind !== "invertebrate").length,
    rows: [...fishRows, ...rows.filter(isInvert)],
    speciesCount: fishRows.filter((r) => r.sp.id !== UNKNOWN).length,
    /** Fish still named "Unknown/Unable to ID due to visibility" that nobody has looked at yet. */
    toLabel: all.filter((d) => d.speciesId === UNKNOWN && !d.verified && isCounted(d, threshold)).length,
    clarity: clarities.length ? clarities.reduce((a, c) => a + c, 0) / clarities.length : null,
    checkedBy: [...new Set(all.map((d) => d.editedBy).filter((x): x is string => !!x))],
    invasive: sumMaxN("invasive"),
    unusual: sumMaxN("unusual"),
    corrected: all.filter((det) => det.speciesId !== det.modelSpeciesId).length,
    confirmed: all.filter((det) => det.verified).length,
    toReview: all.filter((det) => needsReview(det, threshold)).length,
  };
}

export type Summary = ReturnType<typeof summarize>;

/** Counted fish and invertebrates in one picture (used by blind QC and the Excel "Pictures" sheet). */
export function frameCounts(frame: Frame, species: Species[], threshold: number) {
  const kind = new Map(species.map((s) => [s.id, s.kind ?? "fish"]));
  let fish = 0;
  let invertebrates = 0;
  for (const d of frame.detections) {
    if (!isCounted(d, threshold)) continue;
    if (kind.get(d.speciesId) === "invertebrate") invertebrates++;
    else fish++;
  }
  return { fish, invertebrates };
}

/** Things still open on a survey. Shown before export and in "Your surveys". */
export type OpenItem = { key: "review" | "label" | "qc"; text: string };

export function openItems(
  summary: Summary,
  qc?: { done: number; total: number; agreement: number | null; target: number },
) {
  const items: OpenItem[] = [];
  const s = (n: number) => (n === 1 ? "" : "s");
  if (summary.toReview)
    items.push({
      key: "review",
      text: `${summary.toReview} possible fish ${summary.toReview === 1 ? "needs" : "need"} checking`,
    });
  if (summary.toLabel) items.push({ key: "label", text: `${summary.toLabel} unidentified fish not named yet` });
  if (qc && qc.done < qc.total)
    items.push({ key: "qc", text: `Blind QC: ${qc.done} of ${qc.total} picture${s(qc.total)} recounted` });
  else if (qc && qc.agreement !== null && qc.agreement < qc.target)
    items.push({ key: "qc", text: `Blind QC agreement ${Math.round(qc.agreement)}% (target ${qc.target}%)` });
  return items;
}

/** Percent difference used by blind QC: |yours − TIDE's| / TIDE's (0 vs 0 = 0%). */
export function qcDifference(yours: number, app: number) {
  if (yours === app) return 0;
  return (Math.abs(yours - app) / Math.max(app, 1)) * 100;
}

export type Suggestion = { speciesId: string; score: number };

/** The species model's label for a fish far from every species in the list (for expert review). */
export const NOVEL_SIGHTING = "Potential Novel Sighting";
