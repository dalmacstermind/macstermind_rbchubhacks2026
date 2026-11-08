// Trends: one point per counted video, on two stacked graphs with the same time axis, so a drop in
// species can be checked against a drop in clarity. All the numbers come from the back end (GET /trends).
// Every video that isn't on the graphs is listed with the reason.
import { useEffect, useState } from "react";
import type { Trends, TrendsQuery } from "../../../shared/api";
import { api } from "../api";
import { TrendCharts } from "../components/TrendCharts";
import { TrendsFilters } from "../components/TrendsFilters";
import { TrendsNotPlotted } from "../components/TrendsNotPlotted";
import { TrendsTable } from "../components/TrendsTable";
import { VideoDateDialog, type VideoToDate } from "../components/VideoDateDialog";
import type { Theme } from "../theme";
import { Header, btnGhost, btnPrimary, plural } from "../ui";

const ALL_VIDEOS: TrendsQuery = { transect: "", stat: "", from: "", to: "", reviewedOnly: true, groupBySurvey: false };

export function TrendsView({ theme, onOpen }: { theme: Theme; onOpen: (surveyId: number, videoId: number) => void }) {
  const [query, setQuery] = useState(ALL_VIDEOS);
  const [trends, setTrends] = useState<Trends | null>(null);
  const [error, setError] = useState("");
  const [table, setTable] = useState(false);
  const [dating, setDating] = useState<VideoToDate | null>(null);
  const [saves, setSaves] = useState(0); // goes up when a date is saved, so the graphs load again

  // Load again when a filter changes or a date is saved. `current` ignores an answer that arrives
  // after a newer request was made, so quick filter changes can't show old results.
  useEffect(() => {
    let current = true;
    api.trends
      .get(query)
      .then((t) => {
        if (current) {
          setTrends(t);
          setError("");
        }
      })
      .catch((e: Error) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [query, saves]);

  const unreviewed = trends?.notPlotted.filter((n) => n.reason === "not_reviewed").length ?? 0;
  const hasPoints = !!trends?.points.length;

  return (
    <>
      {dating && (
        <VideoDateDialog
          video={dating}
          onClose={() => setDating(null)}
          onSaved={() => {
            setDating(null);
            setSaves((n) => n + 1);
          }}
        />
      )}
      <Header eyebrow="Tools" title="Trends">
        {hasPoints && (
          <button className={btnGhost} onClick={() => setTable(!table)}>
            {table ? "Show graphs" : "Show as table"}
          </button>
        )}
      </Header>
      <div className="space-y-5 px-10 py-6">
        <TrendsFilters
          query={query}
          onChange={setQuery}
          transects={trends?.transects ?? []}
          stats={trends?.stats ?? []}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!trends && !error && <p className="text-muted-foreground">Loading…</p>}
        {trends && !hasPoints && (
          <div className="rounded-2xl border border-border bg-card p-10 text-center text-muted-foreground">
            {unreviewed > 0 ? (
              <>
                <p>{plural(unreviewed, "video")} counted but not reviewed yet, so not shown.</p>
                <button className={`${btnPrimary} mt-3`} onClick={() => setQuery({ ...query, reviewedOnly: false })}>
                  Include AI-only results
                </button>
              </>
            ) : (
              "No counted videos match these filters."
            )}
          </div>
        )}
        {trends && hasPoints && table && <TrendsTable points={trends.points} onOpen={onOpen} onDate={setDating} />}
        {trends && hasPoints && !table && (
          <TrendCharts trends={trends} grouped={query.groupBySurvey} theme={theme} onOpen={onOpen} />
        )}
        {trends && <TrendsNotPlotted videos={trends.notPlotted} onOpen={onOpen} onDate={setDating} />}
      </div>
    </>
  );
}
