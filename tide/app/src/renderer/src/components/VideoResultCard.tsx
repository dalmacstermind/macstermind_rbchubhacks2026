// One video's protocol results: analysis window, MeanCount, species richness, clarity, and its points.
import { useState } from "react";
import type { Person, PointResult, VideoResult } from "../../../shared/api";
import { Chip, btnGhost, plural } from "../ui";
import { PointEditor } from "./PointEditor";
import { PointTable } from "./PointTable";
import { WindowConfirm } from "./WindowConfirm";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function VideoResultCard({
  video: v,
  speciesName,
  categories,
  person,
  onChanged,
}: {
  video: VideoResult;
  speciesName: (id: string) => string;
  categories: string[];
  person: Person;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<PointResult | null>(null);
  const toReview = v.points.filter((p) => p.needsReview && !p.reviewed).length;

  return (
    // The id lets the report's "Show me" button scroll to a video whose window still needs confirming.
    <div id={`video-${v.id}`} className="scroll-mt-4 rounded-2xl border border-border bg-card p-5">
      {editing && (
        <PointEditor
          point={editing}
          categories={categories}
          person={person}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-display text-lg font-semibold">{v.name}</div>
          <div className="text-xs text-muted-foreground">
            {[v.transect, v.stat, v.recordedAt].filter(Boolean).join(" · ") || "Transect, STAT and date not read"}
          </div>
        </div>
        {v.points.length > 0 &&
          (v.reviewed ? (
            <Chip tone="done">Reviewed</Chip>
          ) : (
            <Chip tone="review">{plural(toReview, "point")} to review</Chip>
          ))}
      </div>
      <WindowConfirm video={v} person={person} onChanged={onChanged} />
      {v.points.length === 0 ? null : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Figure label="MeanCount" value={v.meanCount?.toFixed(2) ?? "–"} hint={aiHint(v)} />
            <Figure
              label="Species richness"
              value={String(v.speciesRichness)}
              hint={v.speciesFound.map(speciesName).join(", ") || "No species named yet"}
            />
            <Figure
              label="Clarity index (estimate)"
              value={v.clarityIndex?.toFixed(0) ?? "–"}
              hint={
                v.clarityIndex === null
                  ? ""
                  : `${v.clarityMin}–${v.clarityMax}${v.clarityTrend ? ` · ${v.clarityTrend}` : ""}`
              }
            />
            <Figure label="Visibility" value={v.visibility ?? "–"} hint="Suggested from clarity unless confirmed" />
          </div>
          <PointTable points={v.points} speciesName={speciesName} onOpen={setEditing} />
        </>
      )}
    </div>
  );
}

const aiHint = (v: VideoResult) =>
  v.meanCountAi !== null && v.meanCountAi !== v.meanCount
    ? `AI alone: ${v.meanCountAi.toFixed(2)}`
    : plural(v.points.length, "point");

function Figure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/30 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-2xl font-semibold">{value}</div>
      <div className="truncate text-xs text-muted-foreground" title={hint}>
        {hint}
      </div>
    </div>
  );
}
