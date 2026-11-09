// Protocol results for a survey: one card per video (points, MeanCount, species richness, clarity)
// and a table of image counts. Every number comes from the back end (GET /surveys/{id}/results);
// this screen only shows them.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Person, SurveyResults } from "../../../shared/api";
import type { Species } from "../../../shared/survey";
import { api } from "../api";
import { Alert, btnPrimary, plural } from "../ui";
import { ImageResultsTable } from "./ImageResultsTable";
import { stageOf } from "./CountProgress";
import { VideoResultCard } from "./VideoResultCard";

export function ProtocolResults({
  surveyId,
  species,
  person,
  version,
  onCountingDone,
  onCountingChange,
  focusVideoId,
  onVideoFocused,
}: {
  surveyId: number;
  species: Species[];
  person: Person;
  version: number; // changes when something else on the page changed the survey (labels, checks)
  onCountingDone?: () => void; // reload the rest of the report (its pictures) once a video has been counted
  onCountingChange?: (progress: SurveyCountProgress | null) => void; // null: nothing waiting or being counted
  focusVideoId?: number | null; // scroll to this video once the results have loaded
  onVideoFocused?: () => void;
}) {
  const [results, setResults] = useState<SurveyResults | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.surveys
      .results(surveyId)
      .then(setResults)
      .catch((e: Error) => setError(e.message));
  }, [surveyId]);

  // Reload whenever the survey changes, or something else on the page edited it.
  useEffect(load, [load, version]);

  // Keep checking while something can still change without this page knowing (a window confirmed or
  // counting started or stopped elsewhere): every 2 seconds while a video is being counted, every 5
  // seconds while a window waits for confirmation. Once every video is counted, it stops checking.
  const counting = !!results?.videos.some((v) => v.countState === "queued" || v.countState === "running");
  const unconfirmed = results?.videos.filter((v) => !v.tooShort && !v.confirmedBy) ?? [];
  const waiting = unconfirmed.length > 0;
  useEffect(() => {
    if (!counting && !waiting) return;
    const t = setInterval(load, counting ? 2000 : 5000);
    return () => clearInterval(t);
  }, [counting, waiting, load]);

  // Also check again whenever staff come back to TIDE's window, in case something changed meanwhile.
  useEffect(() => {
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  // Opened from a point on Trends: once the results are on the page, scroll to that video.
  useEffect(() => {
    if (focusVideoId === null || focusVideoId === undefined || !results) return;
    document.getElementById(`video-${focusVideoId}`)?.scrollIntoView({ behavior: "smooth" });
    onVideoFocused?.();
  }, [focusVideoId, results, onVideoFocused]);

  // When counting finishes, the report's pictures (Approve Findings, picture-by-picture counts) are new too.
  const progress = countProgress(results);
  const progressKey = progress ? `${progress.state}|${progress.percent}|${progress.detail}|${progress.etaS}` : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps -- progressKey stands for progress
  useEffect(() => onCountingChange?.(progress), [progressKey, onCountingChange]);
  const wasCounting = useRef(false);
  useEffect(() => {
    if (wasCounting.current && !counting) onCountingDone?.();
    wasCounting.current = counting;
  }, [counting, onCountingDone]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!results) return <p className="text-sm text-muted-foreground">Loading the results…</p>;
  if (!results.videos.length && !results.images.length) return null;

  const name = (id: string) => species.find((s) => s.id === id)?.common ?? id;
  return (
    <section id="protocol-results" className="scroll-mt-4 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Protocol results</h2>
          <p className="text-sm text-muted-foreground">
            Counts at the subsample points (MeanCount) and species richness, following the FFH video protocol.
            {results.unknownsRemaining > 0 && ` ${results.unknownsRemaining} unknown fish still to label.`}
          </p>
        </div>
      </div>
      {waiting && (
        <Alert
          tone="warning"
          icon="⚠"
          title={`${plural(unconfirmed.length, "video")} waiting for you: confirm the analysis window`}
          action={
            <button
              className={btnPrimary}
              onClick={() =>
                document.getElementById(`video-${unconfirmed[0]?.id}`)?.scrollIntoView({ behavior: "smooth" })
              }
            >
              Show me
            </button>
          }
        >
          TIDE has proposed when each video&apos;s analysis window starts. No fish are counted until a person checks it
          and chooses <b>Confirm window and count</b>.
        </Alert>
      )}
      {results.videos.map((v) => (
        <VideoResultCard
          key={v.id}
          video={v}
          speciesName={name}
          categories={results.visibilityCategories}
          person={person}
          onChanged={load}
        />
      ))}
      {results.images.length > 0 && <ImageResultsTable images={results.images} speciesName={name} />}
    </section>
  );
}

/** The whole survey's counting progress: the average over its confirmed videos (counted ones are 100%). */
export type SurveyCountProgress = { state: "queued" | "running"; percent: number; detail: string; etaS: number | null };

export function countProgress(results: SurveyResults | null): SurveyCountProgress | null {
  const vids = (results?.videos ?? []).filter((v) => v.confirmedBy);
  const busy = vids.filter((v) => v.countState === "queued" || v.countState === "running");
  if (!busy.length) return null;
  const running = busy.filter((v) => v.countState === "running");
  const pct = (v: (typeof vids)[number]) =>
    v.countState === "running" ? (v.countPercent ?? 0) : v.countState === "done" ? 100 : 0;
  const percent = Math.round((vids.reduce((n, v) => n + pct(v), 0) / vids.length) * 10) / 10;
  const now = running[0];
  return {
    state: running.length ? "running" : "queued",
    percent,
    detail: now
      ? busy.length > 1
        ? `${stageOf(now.countDetail)} (${busy.length} videos to go)`
        : now.countDetail
      : (busy[0]?.countDetail ?? ""),
    // Videos still waiting have no estimate yet, so the time left is only known while one video is left.
    etaS: now && busy.length === 1 ? now.countEtaS : null,
  };
}
