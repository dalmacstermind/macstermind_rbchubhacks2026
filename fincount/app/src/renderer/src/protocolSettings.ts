// The protocol fields on the Settings screen, and small helpers for showing them.
// The back end checks every rule and works out "→ N points"; this file only describes how each
// value is shown (label, unit) and converts the analysis window between minutes and seconds.
import type { ProtocolSettings } from "../../shared/api";

export type FieldKey = Exclude<keyof ProtocolSettings, "maxToleranceS" | "pointsPerWindow">;

export type ProtocolField = {
  key: FieldKey;
  label: string;
  unit: "s" | "± s" | "min" | "%";
  group: "Analysis window" | "Subsample points" | "Blind quality check";
};

export const PROTOCOL_FIELDS: ProtocolField[] = [
  { key: "trimStartS", label: "Trim at the start", unit: "s", group: "Analysis window" },
  { key: "trimEndS", label: "Trim at the end", unit: "s", group: "Analysis window" },
  { key: "maxExtraSettleS", label: "Extra settling time allowed", unit: "s", group: "Analysis window" },
  { key: "lengthS", label: "Analysis window", unit: "min", group: "Analysis window" },
  { key: "intervalS", label: "Subsample interval", unit: "s", group: "Subsample points" },
  { key: "firstPointOffsetS", label: "First point after the window start", unit: "s", group: "Subsample points" },
  { key: "contextS", label: "Context around each point", unit: "± s", group: "Subsample points" },
  { key: "toleranceS", label: "Count tolerance", unit: "± s", group: "Subsample points" },
  { key: "qcSamplePct", label: "QC sample", unit: "%", group: "Blind quality check" },
  { key: "qcMaxDiffPct", label: "QC maximum difference", unit: "%", group: "Blind quality check" },
  { key: "qcAgreementPct", label: "QC agreement target", unit: "%", group: "Blind quality check" },
];

/** The number shown in the box: the analysis window in minutes, everything else as stored. */
export function shown(field: ProtocolField, s: ProtocolSettings): number {
  return field.unit === "min" ? s[field.key] / 60 : s[field.key];
}

/** The value to store from what was typed: minutes back to seconds for the analysis window. */
export function stored(field: ProtocolField, typed: number): number {
  return field.unit === "min" ? typed * 60 : typed;
}

/** "15 min", "±5 s", "10%": for the summary shown before saving. */
export function describe(field: ProtocolField, s: ProtocolSettings): string {
  const v = shown(field, s);
  if (field.unit === "%") return `${v}%`;
  if (field.unit === "± s") return `±${v} s`;
  return `${v} ${field.unit}`;
}

export type Change = { label: string; from: string; to: string };

/** Only the fields that differ, in screen order. */
export function changedFields(before: ProtocolSettings, after: ProtocolSettings): Change[] {
  return PROTOCOL_FIELDS.filter((f) => before[f.key] !== after[f.key]).map((f) => ({
    label: f.label,
    from: describe(f, before),
    to: describe(f, after),
  }));
}
