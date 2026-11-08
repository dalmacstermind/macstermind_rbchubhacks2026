// The Trends points as a table: readable without the graphs, and where a recording date can be corrected.
import type { TrendPoint } from "../../../shared/api";
import { Chip, btnLink } from "../ui";
import type { VideoToDate } from "./VideoDateDialog";

const HEADINGS = ["Date", "Transect", "STAT", "Video", "Clarity index", "Species found", "MeanCount", "Reviewed", ""];

export function TrendsTable({
  points,
  onOpen,
  onDate,
}: {
  points: TrendPoint[];
  onOpen: (surveyId: number, videoId: number) => void;
  onDate: (video: VideoToDate) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            {HEADINGS.map((h) => (
              <th key={h} className="px-5 py-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.videoId} className="border-t border-border">
              <td className="px-5 py-2.5">{p.recordedAt}</td>
              <td className="px-5 py-2.5">{p.transect || "—"}</td>
              <td className="px-5 py-2.5">{p.stat || "—"}</td>
              <td className="max-w-64 truncate px-5 py-2.5">
                <button className={btnLink} title={p.fileName} onClick={() => onOpen(p.surveyId, p.videoId)}>
                  {p.fileName}
                </button>
                {p.shortWindow && <span className="ml-2 text-xs text-muted-foreground">↔ short window</span>}
              </td>
              <td className="px-5 py-2.5">{p.clarityIndex ?? "—"}</td>
              <td className="px-5 py-2.5">{p.speciesFound}</td>
              <td className="px-5 py-2.5">{p.meanCount ?? "—"}</td>
              <td className="px-5 py-2.5">
                {p.reviewed ? <Chip tone="done">Yes</Chip> : <Chip tone="review">AI only</Chip>}
              </td>
              <td className="px-5 py-2.5">
                <button
                  className={btnLink}
                  onClick={() => onDate({ videoId: p.videoId, fileName: p.fileName, recordedAt: p.recordedAt })}
                >
                  Change date
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
