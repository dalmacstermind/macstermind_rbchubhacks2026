// One survey on the Surveys page: name, date, fish count, Completed/Pending, and what's still open.
// Each open item is a button that goes straight to where it can be done.
import { isSurveyComplete } from "../../../shared/survey";
import type { OpenTarget, SurveyOverview } from "../overview";
import { Chip, btnLink, plural } from "../ui";

export function SurveyRow({
  o,
  onOpen,
  onDelete,
}: {
  o: SurveyOverview;
  onOpen: (id: number, t: OpenTarget) => void;
  onDelete: () => void;
}) {
  const s = o.data.survey;
  const complete = isSurveyComplete(o.open);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{s.site}</span>
          {complete ? (
            <Chip tone="done">Completed</Chip>
          ) : (
            <Chip tone="waiting">Pending</Chip>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {s.surveyDate ? `Filmed ${s.surveyDate}` : "No date filmed"} · {plural(s.frameCount, "picture")} ·{" "}
          {s.videosToCount > 0 && o.summary.total === 0 ? "not counted yet" : `${o.summary.total} fish`}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {o.open.map((item) => (
          <button
            key={item.key}
            onClick={() => onOpen(s.id, item.key === "window" || item.key === "count" ? "report" : item.key)}
            className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Go there"
          >
            {/* Blind QC doesn't decide Completed/Pending, so it gets a quieter chip. */}
            <Chip tone={item.key === "qc" ? "info" : "review"}>{item.text} →</Chip>
          </button>
        ))}
        <button className={`${btnLink} ml-2`} onClick={() => onOpen(s.id, "report")}>
          Open report
        </button>
        <button className="ml-2 text-sm text-muted-foreground hover:text-destructive" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
