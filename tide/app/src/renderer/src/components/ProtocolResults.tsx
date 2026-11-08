// Protocol results for a survey: one card per video (points, MeanCount, species richness, clarity)
// and a table of image counts. Every number comes from the back end (GET /surveys/{id}/results);
// this screen only shows them.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Person, SurveyResults } from "../../../shared/api";
import type { Species } from "../../../shared/survey";
import { api } from "../api";
import { EvaluationPanel } from "./EvaluationPanel";
import { ImageResultsTable } from "./ImageResultsTable";
import { VideoResultCard } from "./VideoResultCard";

export function ProtocolResults({
  surveyId,
  species,
  person,
  version,
  onCountingDone,
}: {
  surveyId: number;
  species: Species[];
  person: Person;
  version: number; // changes when something else on the page changed the survey (labels, checks)
  onCountingDone?: () => void; // reload the rest of the report (its pictures) once a video has been counted
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

  // While a video is being counted (after its window was confirmed), check again every 2 seconds.
  const counting = !!results?.videos.some((v) => v.countState === "queued" || v.countState === "running");
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [counting, load]);

  // When counting finishes, the report's pictures (Check the fish, picture-by-picture counts) are new too.
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
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Protocol results</h2>
          <p className="text-sm text-muted-foreground">
            Counts at the subsample points (MeanCount) and species richness, following the FFH video protocol.
            {results.unknownsRemaining > 0 && ` ${results.unknownsRemaining} unknown fish still to label.`}
          </p>
        </div>
        {results.videos.length > 0 && <EvaluationPanel surveyId={surveyId} />}
      </div>
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
