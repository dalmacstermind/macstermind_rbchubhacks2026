// A strip above every page while videos are being counted: counting can take a long time and carries
// on in the background, so its progress stays visible wherever staff are in the app.
import type { CountStatus } from "../../../shared/api";
import { isCounting } from "../counts";
import { btnGhost } from "../ui";

export function CountingBanner({
  counts,
  busy,
  onOpen,
}: {
  counts: CountStatus[];
  busy: boolean; // files are being checked: other screens are locked until that finishes
  onOpen: (surveyId: number) => void;
}) {
  const active = counts.filter((c) => isCounting(c.state));
  const current = active.find((c) => c.state === "running") ?? active[0];
  if (!current) return null;
  const waiting = active.length - 1;
  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-primary/10 px-6 py-2 text-sm print:hidden"
    >
      <span className="min-w-0 truncate">
        <span aria-hidden>⏳ </span>
        <b>{current.fileName}</b>: {current.detail || "Counting…"}
        {waiting > 0 && ` · ${waiting} more waiting`}
        <span className="text-muted-foreground"> · Keep TIDE open until it finishes</span>
      </span>
      <button className={`${btnGhost} shrink-0 py-1`} disabled={busy} onClick={() => onOpen(current.surveyId)}>
        Open survey
      </button>
    </div>
  );
}
