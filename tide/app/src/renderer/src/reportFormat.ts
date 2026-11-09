// Display helpers for the PDF report. Formatting only: every number comes from the back end.

export function fileSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/** "2025-08-20" → "20 Aug 2025". Anything else is shown as it is. */
export function niceDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso || "Not recorded";
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1];
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/** "T1_clip.MP4", "b.jpg" → "MP4, JPG". */
export function fileTypes(names: string[]): string {
  const types = names.map((n) => (n.includes(".") ? n.split(".").pop()!.toUpperCase() : "Other"));
  return [...new Set(types)].sort().join(", ") || "None";
}

export const joined = (items: string[], empty: string) => [...new Set(items.filter(Boolean))].join(", ") || empty;
