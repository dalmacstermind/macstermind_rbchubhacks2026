// Home: add footage, fill in the survey, count. Below: earlier surveys, unfinished ones first.
import { useState } from "react";
import type { AnalysisRequest, PickedFile, Sampling, SkippedFile } from "../../../shared/api";
import type { OpenItem } from "../../../shared/survey";
import { api } from "../api";
import type { SurveyOverview } from "../overview";
import { Chip, Disclosure, Field, Header, btnGhost, btnLink, btnPrimary, formatBytes, plural, useConfirm } from "../ui";

export type SurveyForm = Omit<AnalysisRequest, "files" | "person">;
export type OpenTarget = "report" | OpenItem["key"];

const RECENT = 5; // surveys listed before "Show all"

export function UploadView({
  files,
  setFiles,
  form,
  setForm,
  error,
  onStart,
  overview,
  onOpen,
  onDeleted,
}: {
  files: PickedFile[];
  setFiles: (f: PickedFile[]) => void;
  form: SurveyForm;
  setForm: (f: SurveyForm) => void;
  error: string | null;
  onStart: () => void;
  overview: SurveyOverview[] | null;
  onOpen: (surveyId: number, target: OpenTarget) => void;
  onDeleted: () => void;
}) {
  const [drag, setDrag] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [skipped, setSkipped] = useState<SkippedFile[]>([]);
  const [confirmNode, confirm] = useConfirm();
  const set = <K extends keyof SurveyForm>(k: K, v: SurveyForm[K]) => setForm({ ...form, [k]: v });

  const add = async (paths: string[]) => {
    if (!paths.length) return;
    const r = await window.desktop.expand(paths);
    setSkipped(r.skipped);
    setFiles([...files, ...r.files.filter((f) => !files.some((x) => x.path === f.path))]);
  };
  const total = files.reduce((a, f) => a + f.size, 0);
  // One list of earlier surveys: the ones that still need work come first, then the finished ones.
  const withWork = (overview ?? []).filter((o) => o.open.length > 0);
  const sorted = [...withWork, ...(overview ?? []).filter((o) => o.open.length === 0)];
  const shown = showAll ? sorted : sorted.slice(0, RECENT);

  return (
    <>
      {confirmNode}
      <Header eyebrow="Step 1 of 4" title="Start a new survey" />
      <div className="grid grid-cols-1 gap-8 px-10 py-8 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {error && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-5 py-3 text-sm">
              <b>Something went wrong while counting.</b>{" "}
              <span className="whitespace-pre-wrap text-muted-foreground">{error}</span>
            </div>
          )}

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void add(window.desktop.pathsOf(Array.from(e.dataTransfer.files)));
            }}
            className={`rounded-2xl border-2 border-dashed p-12 text-center transition ${
              drag ? "border-primary bg-primary/10" : "border-border bg-card"
            }`}
          >
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-ocean text-2xl text-primary-foreground shadow-glow">
              ↑
            </div>
            <div className="font-display text-xl font-semibold">Drag survey videos, photos or folders here</div>
            <div className="mt-4 flex justify-center gap-2">
              <button className={btnGhost} onClick={() => void window.desktop.pickFiles().then(add)}>
                Choose files
              </button>
              <button className={btnGhost} onClick={() => void window.desktop.pickFolder().then(add)}>
                Choose a folder
              </button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Videos (MP4, MOV, AVI, MKV) · Photos (JPG, PNG) · folders are opened for you
            </p>
          </div>

          {(files.length > 0 || skipped.length > 0) && (
            <div className="rounded-2xl border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-5 py-3 text-sm">
                <span className="font-medium">
                  {plural(files.length, "file")} ready{" "}
                  {files.length > 0 && <span className="text-muted-foreground">· {formatBytes(total)}</span>}
                </span>
                {files.length > 0 && (
                  <button className={btnLink} onClick={() => setFiles([])}>
                    Clear all
                  </button>
                )}
              </div>
              {files.map((f) => (
                <div
                  key={f.path}
                  className="flex items-center justify-between border-b border-border px-5 py-2.5 last:border-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs uppercase text-primary">
                      {f.name.split(".").pop()}
                    </span>
                    <span className="truncate text-sm">{f.name}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-4 text-sm text-muted-foreground">
                    {formatBytes(f.size)}
                    <button
                      onClick={() => setFiles(files.filter((x) => x.path !== f.path))}
                      className="hover:text-destructive"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              {skipped.length > 0 && (
                <Disclosure className="px-5 py-3" label={`${plural(skipped.length, "file")} skipped, show why`}>
                  <ul className="space-y-1 text-sm">
                    {skipped.map((s) => (
                      <li key={s.name} className="flex items-center justify-between gap-4">
                        <span className="truncate text-muted-foreground">{s.name}</span>
                        <Chip tone="skipped">{s.reason}</Chip>
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              )}
            </div>
          )}

          {sorted.length > 0 && (
            <div>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <div className="font-display text-lg font-semibold">Your surveys</div>
                <div className="text-xs text-muted-foreground">
                  {withWork.length > 0 ? `${withWork.length} still need work · ` : ""}
                  {plural(sorted.length, "survey")}
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-card">
                {shown.map((o) => (
                  <SurveyRow
                    key={o.data.survey.id}
                    o={o}
                    onOpen={onOpen}
                    onDelete={() =>
                      confirm(
                        `Delete the survey “${o.data.survey.site}”? Its pictures and checks will be removed from this computer.`,
                        "Delete",
                        () => void api.surveys.remove(o.data.survey.id).then(onDeleted),
                      )
                    }
                  />
                ))}
              </div>
              {sorted.length > shown.length && (
                <button className={`${btnLink} mt-2`} onClick={() => setShowAll(true)}>
                  Show all {sorted.length} surveys
                </button>
              )}
            </div>
          )}
        </div>

        <div className="h-fit space-y-5 rounded-2xl border border-border bg-card p-6">
          <div className="font-display text-lg font-semibold">Survey details</div>
          <Field label="Site name" hint="e.g. “Mahone Bay — Transect 3”">
            <input
              value={form.site}
              placeholder="Where was this filmed?"
              onChange={(e) => set("site", e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Date filmed" hint="Used to show changes over time in Trends.">
            <input
              type="date"
              value={form.surveyDate}
              onChange={(e) => set("surveyDate", e.target.value)}
              className="input"
            />
          </Field>
          <Disclosure label="More options">
            <div className="space-y-5">
              <Field
                label="How closely should we check the video?"
                hint="Checking more pictures finds more fish but takes longer."
              >
                <select
                  className="input"
                  value={form.sampling}
                  onChange={(e) => set("sampling", Number(e.target.value) as Sampling)}
                >
                  <option value={1}>Standard: 1 picture every second</option>
                  <option value={2}>Detailed: 2 pictures every second</option>
                  <option value={5}>Thorough: 5 pictures every second (slow)</option>
                </select>
              </Field>
              <Field
                label={`Count a fish automatically when TIDE is at least ${Math.round(form.threshold * 100)}% sure`}
                hint="Anything less certain is set aside for you to check."
              >
                <input
                  type="range"
                  min={30}
                  max={90}
                  step={5}
                  value={Math.round(form.threshold * 100)}
                  onChange={(e) => set("threshold", Number(e.target.value) / 100)}
                  className="w-full accent-primary"
                />
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.enhance}
                  onChange={(e) => set("enhance", e.target.checked)}
                  className="mt-0.5 accent-primary"
                />
                Clear up murky or cloudy water
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.ignoreSpecks}
                  onChange={(e) => set("ignoreSpecks", e.target.checked)}
                  className="mt-0.5 accent-primary"
                />
                Ignore tiny specks (sediment, bubbles)
              </label>
              <p className="text-xs text-muted-foreground">Change the starting values for these in Settings.</p>
            </div>
          </Disclosure>
          <button disabled={!files.length} onClick={onStart} className={`${btnPrimary} w-full py-3`}>
            Count the fish →
          </button>
          {!files.length && <p className="text-center text-xs text-muted-foreground">Add some footage first</p>}
        </div>
      </div>
    </>
  );
}

function SurveyRow({
  o,
  onOpen,
  onDelete,
}: {
  o: SurveyOverview;
  onOpen: (id: number, t: OpenTarget) => void;
  onDelete?: () => void;
}) {
  const s = o.data.survey;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3 last:border-0">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{s.site}</div>
        <div className="text-xs text-muted-foreground">
          {s.surveyDate ? `Filmed ${s.surveyDate}` : "No date filmed"} · {plural(s.frameCount, "picture")} ·{" "}
          {o.summary.total} fish
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {o.open.length === 0 ? (
          <Chip tone="done">All checked</Chip>
        ) : (
          o.open.map((item) => (
            <button
              key={item.key}
              onClick={() => onOpen(s.id, item.key)}
              className="outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
              title="Go there"
            >
              <Chip tone="review">{item.text} →</Chip>
            </button>
          ))
        )}
        <button className={`${btnLink} ml-2`} onClick={() => onOpen(s.id, "report")}>
          Open report
        </button>
        {onDelete && (
          <button className="ml-2 text-sm text-muted-foreground hover:text-destructive" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
