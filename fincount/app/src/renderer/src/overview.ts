// Loads every finished survey with its summary and blind-QC progress.
// Used by the home screen ("Your surveys") and Trends.
import { useCallback, useEffect, useState } from "react";
import type { QcData, SurveyData } from "../../shared/api";
import {
  frameCounts,
  openItems,
  qcDifference,
  summarize,
  type OpenItem,
  type Species,
  type Summary,
} from "../../shared/survey";
import { api } from "./api";
import type { Prefs } from "./prefs";

export type QcState = {
  total: number; // pictures in the sample
  done: number; // pictures recounted by someone
  agreement: number | null; // % of recounted pictures within the allowed difference
  target: number;
};

export function qcState(data: SurveyData, qc: QcData, species: Species[], prefs: Prefs): QcState {
  const latest = new Map<string, QcData["counts"][number]>();
  for (const c of qc.counts) latest.set(c.frameId, c); // counts come oldest first
  let agree = 0;
  for (const [frameId, c] of latest) {
    const frame = data.frames.find((f) => f.id === frameId);
    if (!frame) continue;
    const app = frameCounts(frame, species, data.survey.threshold);
    if (
      qcDifference(c.fish, app.fish) <= prefs.qcMaxDiff &&
      qcDifference(c.invertebrates, app.invertebrates) <= prefs.qcMaxDiff
    )
      agree++;
  }
  const done = latest.size;
  return { total: qc.sample.length, done, agreement: done ? (agree / done) * 100 : null, target: prefs.qcTarget };
}

export type SurveyOverview = { data: SurveyData; summary: Summary; qc: QcState; open: OpenItem[] };

export function useOverview(species: Species[], prefs: Prefs) {
  const [items, setItems] = useState<SurveyOverview[] | null>(null);
  const load = useCallback(async () => {
    if (!species.length) return;
    const list = await api.surveys.list();
    const all = await Promise.all(
      list.map(async (info) => {
        const [data, qc] = await Promise.all([api.surveys.get(info.id), api.qc.get(info.id, prefs.qcPercent)]);
        const summary = summarize(data.frames, species, data.survey.threshold);
        const q = qcState(data, qc, species, prefs);
        return { data, summary, qc: q, open: openItems(summary, q) };
      }),
    );
    setItems(all);
  }, [species, prefs]);
  useEffect(() => {
    void load();
  }, [load]);
  return [items, load] as const;
}
