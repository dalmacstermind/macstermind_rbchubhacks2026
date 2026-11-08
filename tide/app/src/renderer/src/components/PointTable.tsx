// The subsample points of one video, one row each (mirrors the spreadsheet). Click a row to review it.
import type { PointResult } from "../../../shared/api";
import { Chip } from "../ui";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function PointTable({
  points,
  speciesName,
  onOpen,
}: {
  points: PointResult[];
  speciesName: (id: string) => string;
  onOpen: (p: PointResult) => void;
}) {
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Point</th>
            <th className="px-3 py-2">Time</th>
            <th className="px-3 py-2">Fish</th>
            <th className="px-3 py-2">Invertebrates</th>
            <th className="px-3 py-2">Species</th>
            <th className="px-3 py-2">Unknown</th>
            <th className="px-3 py-2">Clarity</th>
            <th className="px-3 py-2">Visibility</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Notes</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr
              key={p.id}
              onClick={() => onOpen(p)}
              className="cursor-pointer border-t border-border hover:bg-secondary/40"
              title="Review this point"
            >
              <td className="px-3 py-2 font-medium">{p.pointNo}</td>
              <td className="px-3 py-2 font-mono text-xs">{mmss(p.timestampS)}</td>
              <td className="px-3 py-2">
                {p.totalFish}
                {p.totalFish !== p.ai.totalFish && (
                  <span className="ml-1 text-xs text-muted-foreground">(AI {p.ai.totalFish})</span>
                )}
              </td>
              <td className="px-3 py-2">{p.invertebrates}</td>
              <td className="px-3 py-2 text-xs">
                {Object.entries(p.perSpecies)
                  .map(([id, n]) => `${speciesName(id)} ${n}`)
                  .join(", ") || "–"}
              </td>
              <td className="px-3 py-2">{p.unknown}</td>
              <td className="px-3 py-2">{p.clarityIndex?.toFixed(0) ?? "–"}</td>
              <td className="px-3 py-2 text-xs">
                {p.visibility ?? (p.suggestedVisibility ? `${p.suggestedVisibility} (suggested)` : "–")}
              </td>
              <td className="px-3 py-2">
                {p.reviewed ? (
                  <Chip tone="done">{p.editedBy}</Chip>
                ) : p.needsReview ? (
                  <Chip tone="review">Review</Chip>
                ) : (
                  <Chip tone="info">AI</Chip>
                )}
              </td>
              <td className="max-w-xs truncate px-3 py-2 text-xs text-muted-foreground" title={p.notes}>
                {[p.notes, p.staffNotes].filter(Boolean).join("; ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
