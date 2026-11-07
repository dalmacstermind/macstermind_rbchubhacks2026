// Counting in progress. Shows the % in the window title and the Windows taskbar too,
// so staff can work in other windows. Per-file detail is one click away.
import { useEffect, useState } from "react";
import { ANALYSIS_STAGES, type FileStatus, type Progress } from "../../../shared/api";
import { api } from "../api";
import { Chip, Disclosure, Header, plural, type ChipTone } from "../ui";

const FILE_TONE: Record<FileStatus["state"], ChipTone> = {
  waiting: "waiting",
  working: "working",
  done: "done",
  failed: "failed",
  skipped: "skipped",
};
const FILE_WORD: Record<FileStatus["state"], string> = {
  waiting: "Waiting",
  working: "Working",
  done: "Done",
  failed: "Couldn't read",
  skipped: "Skipped",
};

export function ProcessingView({
  count,
  notify,
  setNotify,
}: {
  count: number;
  notify: boolean;
  setNotify: (v: boolean) => void;
}) {
  const [p, setP] = useState<Progress | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(
    () =>
      api.analysis.onProgress((pr) => {
        setP(pr);
        document.title = `(${pr.percent}%) FinCount – Counting`;
        window.desktop.setProgress(pr.percent / 100);
      }),
    [],
  );
  useEffect(
    () => () => {
      document.title = "FinCount";
      window.desktop.setProgress(null);
    },
    [],
  );

  const pct = p?.percent ?? 0;
  const active = p?.stage ?? 0;
  const files = p?.files ?? [];
  const problems = files.filter((f) => f.state === "failed").length;

  return (
    <>
      <Header eyebrow="Step 2 of 4" title="Counting the fish…" />
      <div className="mx-auto max-w-2xl px-10 py-14">
        <div className="relative mx-auto mb-10 h-40 w-40">
          <div className="absolute inset-0 animate-pulse rounded-full bg-primary/20" />
          <div className="absolute inset-4 grid place-items-center rounded-full bg-gradient-ocean font-display text-3xl font-bold text-primary-foreground shadow-glow">
            {pct}%
          </div>
        </div>
        <div
          className="mb-8 h-2 overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full bg-gradient-ocean transition-all" style={{ width: `${pct}%` }} />
        </div>
        <ul className="space-y-3">
          {ANALYSIS_STAGES.map((s, i) => {
            const finished = i < active || pct >= 100;
            return (
              <li
                key={s}
                className={`flex items-center gap-3 ${i <= active ? "text-foreground" : "text-muted-foreground/60"}`}
              >
                <span
                  className={`grid h-5 w-5 place-items-center rounded-full text-[10px] ${
                    finished
                      ? "bg-success text-success-foreground"
                      : i === active
                        ? "border-2 border-primary"
                        : "border border-border"
                  }`}
                >
                  {finished && "✓"}
                </span>
                {s}
              </li>
            );
          })}
        </ul>
        <p className="mt-8 text-center text-sm text-muted-foreground">
          {p?.detail ?? `Getting ${plural(count, "file")} ready…`}
        </p>

        {files.length > 0 && (
          <Disclosure
            className="mt-6"
            label={
              <>
                Details for each file{" "}
                {problems > 0 && <Chip tone="failed">{plural(problems, "file")} couldn't be read</Chip>}
              </>
            }
            defaultOpen={problems > 0}
          >
            <div className="rounded-xl border border-border bg-card">
              {files.map((f) => (
                <div
                  key={f.name}
                  className="flex items-center justify-between gap-4 border-b border-border px-4 py-2.5 text-sm last:border-0"
                >
                  <div className="min-w-0">
                    <div className="truncate">{f.name}</div>
                    {f.detail && <div className="truncate text-xs text-muted-foreground">{f.detail}</div>}
                  </div>
                  <Chip tone={FILE_TONE[f.state]}>{FILE_WORD[f.state]}</Chip>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">A file that can't be read never stops the others.</p>
          </Disclosure>
        )}

        <div className="mt-8 flex flex-col items-center gap-3 text-sm">
          <label className="flex items-center gap-2 text-muted-foreground">
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              className="accent-primary"
            />
            Let me know when it's done (desktop notification)
          </label>
          <button
            disabled={cancelling}
            onClick={() => {
              setCancelling(true);
              void api.analysis.cancel();
            }}
            className="text-muted-foreground underline hover:text-foreground disabled:opacity-50"
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </button>
        </div>
      </div>
    </>
  );
}
