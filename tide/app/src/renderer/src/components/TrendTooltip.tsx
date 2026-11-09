// What shows when hovering a point on the Trends graphs: a video's details, or a date's summary when grouped.
import type { TooltipContentProps } from "recharts";
import type { TrendGroup, TrendPoint } from "../../../shared/api";

export type TrendRow = TrendPoint | TrendGroup;
export const isGroup = (r: TrendRow): r is TrendGroup => "videos" in r;

const orDash = (v: number | string | null) => v ?? "—";

const Row = ({ label, value }: { label: string; value: string | number }) => (
  <div className="flex justify-between gap-4">
    <span className="text-muted-foreground">{label}</span>
    <b>{value}</b>
  </div>
);

function VideoDetails({ p }: { p: TrendPoint }) {
  return (
    <>
      <div className="font-semibold">{p.label}</div>
      <div className="mb-1 text-muted-foreground">{p.fileName}</div>
      <Row label="Clarity index" value={p.clarityIndex === null ? "—" : `${p.clarityIndex} / 100`} />
      <Row label="Visibility" value={orDash(p.visibility)} />
      <Row label="Species found" value={p.speciesFound} />
      <Row label="MeanCount" value={orDash(p.meanCount)} />
      <div className="mt-1 text-muted-foreground">{p.reviewed ? "✓ Reviewed" : "⚠ AI only, not reviewed"}</div>
      {p.shortWindow && <div className="text-muted-foreground">↔ Short window: not comparable with full windows</div>}
    </>
  );
}

function GroupDetails({ g }: { g: TrendGroup }) {
  return (
    <>
      <div className="font-semibold">{g.label}</div>
      <div className="mb-1 text-muted-foreground">
        {g.videos} video{g.videos === 1 ? "" : "s"}
      </div>
      <Row
        label="Clarity index"
        value={g.clarityMean === null ? "—" : `${g.clarityMean} (${g.clarityMin}–${g.clarityMax})`}
      />
      <Row label="Species found" value={`${g.speciesMean} (${g.speciesMin}–${g.speciesMax})`} />
      <Row label="MeanCount" value={orDash(g.meanCount)} />
    </>
  );
}

export function TrendTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  const row = active && (payload?.[0]?.payload as TrendRow | undefined);
  if (!row) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      {isGroup(row) ? <GroupDetails g={row} /> : <VideoDetails p={row} />}
    </div>
  );
}
