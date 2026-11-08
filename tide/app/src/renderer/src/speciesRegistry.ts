// Small helpers for the Species Registry page: sorting, searching, the "New" badge, image counts and
// where a reference picture came from. No screen code here, so the tests can check them directly.
import type { Reference } from "../../shared/api";
import type { Species } from "../../shared/survey";

/** A species added within this many days gets a "New" badge on its card. */
export const NEW_DAYS = 7;

/** Alphabetical by common name, ignoring upper and lower case. */
export function sortSpecies(list: Species[]): Species[] {
  return [...list].sort((a, b) => a.common.localeCompare(b.common, undefined, { sensitivity: "base" }));
}

/** The species whose common or scientific name contains the search text (any case). Empty search: all. */
export function filterSpecies(list: Species[], query: string): Species[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((s) => `${s.common} ${s.scientific}`.toLowerCase().includes(q));
}

/** True if staff added the species in the last NEW_DAYS days. addedAt looks like "2026-11-08 14:02:11". */
export function isNew(addedAt: string | undefined, now: Date = new Date()): boolean {
  if (!addedAt) return false; // species that came with the app have no date
  const added = new Date(addedAt.replace(" ", "T")); // "T" makes it a date the browser reads as local time
  if (Number.isNaN(added.getTime())) return false;
  const age = now.getTime() - added.getTime();
  return age >= 0 && age <= NEW_DAYS * 24 * 60 * 60 * 1000;
}

/** "1 image", "5 images". */
export const imageCount = (n = 0) => `${n} image${n === 1 ? "" : "s"}`;

/** The scientific name, or "" when it isn't known (stored as "—" or empty). */
export const knownScientific = (s: string) => (s && s !== "—" ? s : "");

/** Where a reference picture came from, in words, e.g. 'Survey "Mahone Bay" · GX010021.MP4 at 00:06:00'. */
export function describeSource(r: Reference): string {
  if (r.sourceFile) {
    const survey = r.surveySite ? `Survey "${r.surveySite}" · ` : r.surveyId ? `Survey ${r.surveyId} · ` : "";
    return `${survey}${r.sourceFile}${r.sourceTime ? ` at ${r.sourceTime}` : ""}`;
  }
  return r.source || "Not recorded"; // an uploaded picture's file name, or an older picture's note
}
