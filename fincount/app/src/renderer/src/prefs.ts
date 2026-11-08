// Settings saved on this computer (Settings screen). They apply to new surveys only.
import { useState } from "react";
import type { Sampling } from "../../shared/api";

export type Prefs = {
  threshold: number; // 0–1: below this, staff check before it counts
  sampling: Sampling;
  enhance: boolean;
  ignoreSpecks: boolean;
  lookCloser: boolean; // tiled search for small fish (slower)
  qcPercent: number; // % of pictures picked for blind QC
  qcMaxDiff: number; // % difference that asks for a recount
  qcTarget: number; // % of QC pictures that should agree
  notify: boolean; // desktop notification when counting finishes
};

export const DEFAULT_PREFS: Prefs = {
  threshold: 0.5,
  sampling: 1,
  enhance: true,
  ignoreSpecks: true,
  lookCloser: false,
  qcPercent: 10,
  qcMaxDiff: 6,
  qcTarget: 95,
  notify: true,
};

const KEY = "fincount.prefs";

function load(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(load);
  const save = (p: Prefs) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      /* kept for this session */
    }
    setPrefs(p);
  };
  return [prefs, save] as const;
}
