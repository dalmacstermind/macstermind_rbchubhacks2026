// The app shell: sidebar, who's working, theme, and which screen is showing.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FileStatus, ModelStatus, Person, PickedFile, QcData, SurveyData } from "../../shared/api";
import { summarize, type Detection, type Species } from "../../shared/survey";
import { api } from "./api";
import { qcState, useOverview } from "./overview";
import { usePrefs } from "./prefs";
import { ShortcutsSheet, useKeys } from "./shortcuts";
import { useTheme } from "./theme";
import { Alert, btnGhost, initials, plural } from "./ui";
import { WhoIsWorking } from "./views/People";
import { ProcessingView } from "./views/Processing";
import { QcView } from "./views/QC";
import { LabelView } from "./views/Label";
import { ReportView, type ReviewMode } from "./views/Report";
import { ReviewView } from "./views/Review";
import { SettingsView } from "./views/Settings";
import { SpeciesView } from "./views/Species";
import { TrendsView } from "./views/Trends";
import { UploadView, type OpenTarget, type SurveyForm } from "./views/Upload";

type Page = "upload" | "processing" | "report" | "review" | "label" | "qc" | "trends" | "species" | "settings";

export default function App() {
  const [person, setPerson] = useState<Person | null>(null);
  const [theme, setTheme] = useTheme();
  const [prefs, setPrefs] = usePrefs();
  const [page, setPage] = useState<Page>("upload");
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [form, setForm] = useState<SurveyForm>(() => ({
    site: "",
    surveyDate: "",
    environment: "Coastal marine",
    threshold: prefs.threshold,
    sampling: prefs.sampling,
    enhance: prefs.enhance,
    ignoreSpecks: prefs.ignoreSpecks,
    lookCloser: prefs.lookCloser,
  }));
  const [species, setSpecies] = useState<Species[]>([]);
  const [model, setModel] = useState<ModelStatus | null>(null);
  const [data, setData] = useState<SurveyData | null>(null);
  const [qcRaw, setQcRaw] = useState<QcData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState<FileStatus[] | null>(null);
  const [reviewMode, setReviewMode] = useState<ReviewMode>("all");
  const [qcSurvey, setQcSurvey] = useState<number | null>(null);
  const [shortcuts, setShortcuts] = useState(false);
  const [overview, reloadOverview] = useOverview(species, prefs);

  useEffect(() => {
    void api.species.list().then(setSpecies);
    void api.model.status().then(setModel);
  }, []);
  useKeys({ "?": () => setShortcuts(true) }, !!person);

  const summary = useMemo(
    () => (data ? summarize(data.frames, species, data.survey.threshold) : null),
    [data, species],
  );
  const qc = useMemo(
    () => (data && qcRaw ? qcState(data, qcRaw, species, prefs) : null),
    [data, qcRaw, species, prefs],
  );

  const go = (p: Page) => {
    if (p === "upload" || p === "qc" || p === "trends") void reloadOverview();
    if (p === "report" && data) void api.qc.get(data.survey.id, prefs.qcPercent).then(setQcRaw);
    if (p === "qc") setQcSurvey(null);
    setPage(p);
  };

  const openSurvey = useCallback(
    async (id: number, target: OpenTarget = "report") => {
      const [d, q] = await Promise.all([api.surveys.get(id), api.qc.get(id, prefs.qcPercent)]);
      setData(d);
      setQcRaw(q);
      setFinished(null);
      if (target === "qc") {
        setQcSurvey(id);
        setPage("qc");
      } else if (target === "report") setPage("report");
      else {
        setReviewMode(target);
        setPage("review");
      }
    },
    [prefs.qcPercent],
  );

  const start = async () => {
    if (!person) return;
    setError(null);
    setPage("processing");
    try {
      const r = await api.analysis.start({ ...form, person: person.name, files: files.map((f) => f.path) });
      setFiles([]);
      setForm({ ...form, site: "", surveyDate: "" });
      await openSurvey(r.surveyId);
      setFinished(r.files);
      if (prefs.notify) {
        const failed = r.files.filter((f) => f.state === "failed").length;
        new Notification("TIDE: counting finished", {
          body: `${form.site || "Your survey"} is ready${failed ? ` · ${plural(failed, "file")} couldn't be read` : ""}.`,
        });
      }
    } catch (e) {
      const msg = (e as Error).message;
      setPage("upload");
      if (!msg.includes("cancelled")) setError(msg);
    }
  };

  const editDetection = useCallback(
    (frameId: string, det: Detection, patch: Pick<Detection, "speciesId" | "verified">) => {
      const by = patch.verified ? (person?.name ?? "") : "";
      setData(
        (d) =>
          d && {
            ...d,
            frames: d.frames.map((f) =>
              f.id !== frameId
                ? f
                : {
                    ...f,
                    detections: f.detections.map((x) => (x.id === det.id ? { ...x, ...patch, editedBy: by } : x)),
                  },
            ),
          },
      );
      void api.detections.update(det.id, { ...patch, by }); // saved straight away
    },
    [person],
  );

  if (!person) return <WhoIsWorking onPick={setPerson} />;

  const busy = page === "processing";
  const failed = finished?.filter((f) => f.state !== "done") ?? [];

  return (
    <div className="flex h-screen bg-background text-foreground">
      {shortcuts && <ShortcutsSheet onClose={() => setShortcuts(false)} />}
      <Sidebar
        page={page}
        go={go}
        busy={busy}
        hasSurvey={!!data}
        toCheck={summary ? summary.toReview + summary.toLabel : 0}
        person={person}
        switchPerson={() => setPerson(null)}
        theme={theme}
        setTheme={setTheme}
        model={model}
        onShortcuts={() => setShortcuts(true)}
      />
      <main className="flex-1 overflow-auto">
        {page === "upload" && (
          <UploadView
            files={files}
            setFiles={setFiles}
            form={form}
            setForm={setForm}
            error={error}
            onStart={start}
            overview={overview}
            onOpen={(id, t) => void openSurvey(id, t)}
            onDeleted={() => void reloadOverview()}
          />
        )}
        {page === "processing" && (
          <ProcessingView
            count={files.length}
            notify={prefs.notify}
            setNotify={(v) => setPrefs({ ...prefs, notify: v })}
          />
        )}
        {page === "report" && data && summary && (
          <>
            {finished && (
              <div className="px-10 pt-6">
                <Alert
                  tone={failed.length ? "warning" : "success"}
                  icon={failed.length ? "⚠" : "✓"}
                  title={`Counting finished${failed.length ? `, but ${plural(failed.length, "file")} couldn't be used` : ""}`}
                  action={
                    <button className={btnGhost} onClick={() => setFinished(null)}>
                      Dismiss
                    </button>
                  }
                >
                  {failed.length
                    ? failed.map((f) => `${f.name}: ${f.detail}`).join(" · ")
                    : `${plural(finished.length, "file")} counted.`}
                </Alert>
              </div>
            )}
            <ReportView
              data={data}
              summary={summary}
              species={species}
              qc={qc}
              person={person}
              onReview={(m) => {
                setReviewMode(m);
                setPage("review");
              }}
              onQc={() => {
                setQcSurvey(data.survey.id);
                setPage("qc");
              }}
              onChanged={() => void openSurvey(data.survey.id)}
            />
          </>
        )}
        {page === "review" && data && summary && (
          <ReviewView
            key={`${data.survey.id}-${reviewMode}`}
            frames={data.frames}
            species={species}
            setSpecies={setSpecies}
            threshold={data.survey.threshold}
            total={summary.total}
            toReview={summary.toReview}
            startMode={reviewMode}
            person={person}
            edit={editDetection}
            onBack={() => go("report")}
          />
        )}
        {page === "qc" && (
          <QcView
            overview={overview}
            species={species}
            prefs={prefs}
            person={person}
            surveyId={qcSurvey}
            setSurveyId={(id) => {
              setQcSurvey(id);
              if (id === null) void reloadOverview();
            }}
            onChanged={() => data && void api.qc.get(data.survey.id, prefs.qcPercent).then(setQcRaw)}
          />
        )}
        {page === "trends" && (
          <TrendsView
            overview={overview}
            theme={theme}
            onOpen={(id) => void openSurvey(id)}
            onChanged={() => void reloadOverview()}
          />
        )}
        {page === "label" && data && (
          <LabelView
            key={data.survey.id}
            data={data}
            species={species}
            setSpecies={setSpecies}
            person={person}
            onChanged={() => void api.surveys.get(data.survey.id).then(setData)}
          />
        )}
        {page === "species" && <SpeciesView species={species} setSpecies={setSpecies} person={person} />}
        {page === "settings" && <SettingsView prefs={prefs} setPrefs={setPrefs} person={person} />}
      </main>
    </div>
  );
}

function Sidebar({
  page,
  go,
  busy,
  hasSurvey,
  toCheck,
  person,
  switchPerson,
  theme,
  setTheme,
  model,
  onShortcuts,
}: {
  page: Page;
  go: (p: Page) => void;
  busy: boolean;
  hasSurvey: boolean;
  toCheck: number;
  person: Person;
  switchPerson: () => void;
  theme: "light" | "dark";
  setTheme: (t: "light" | "dark") => void;
  model: ModelStatus | null;
  onShortcuts: () => void;
}) {
  const survey: { id: Page; label: string; n: string; enabled: boolean; badge?: number }[] = [
    { id: "upload", label: "New survey", n: "1", enabled: !busy },
    { id: "processing", label: "Counting", n: "2", enabled: false },
    { id: "report", label: "Report", n: "3", enabled: hasSurvey && !busy },
    { id: "review", label: "Check the fish", n: "4", enabled: hasSurvey && !busy, badge: toCheck },
    { id: "label", label: "Label unknown fish", n: "5", enabled: hasSurvey && !busy },
  ];
  const tools: { id: Page; label: string; icon: string }[] = [
    { id: "qc", label: "Blind QC", icon: "✓" },
    { id: "trends", label: "Trends", icon: "↗" },
    { id: "species", label: "Species list", icon: "≡" },
    { id: "settings", label: "Settings", icon: "⚙" },
  ];
  const navBtn = (active: boolean) =>
    `flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring ${
      active
        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
    } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`;
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground print:hidden">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-ocean font-display text-lg font-bold text-primary-foreground">
          T
        </div>
        <div>
          <div className="font-display text-lg font-semibold leading-none">TIDE</div>
          <div className="mt-1 text-xs text-sidebar-foreground/60">Fish survey analysis</div>
        </div>
      </div>
      <nav className="flex flex-col gap-0.5 px-3">
        {survey.map((it) => (
          <button key={it.id} disabled={!it.enabled} onClick={() => go(it.id)} className={navBtn(page === it.id)}>
            <span className="grid h-5 w-5 place-items-center rounded-full border border-sidebar-primary/60 text-[11px] text-sidebar-primary">
              {it.n}
            </span>
            <span className="flex-1">{it.label}</span>
            {!!it.badge && (
              <span
                className="rounded-full bg-warning px-2 text-xs font-semibold text-warning-foreground"
                title={`${it.badge} to check`}
              >
                {it.badge}
              </span>
            )}
          </button>
        ))}
        <div className="mx-3 mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
          Tools
        </div>
        {tools.map((it) => (
          <button key={it.id} disabled={busy} onClick={() => go(it.id)} className={navBtn(page === it.id)}>
            <span className="grid h-5 w-5 place-items-center text-sidebar-primary" aria-hidden>
              {it.icon}
            </span>
            {it.label}
          </button>
        ))}
      </nav>

      <div className="mt-auto space-y-3 p-3">
        {model?.demo && (
          <p className="rounded-md bg-warning/15 px-3 py-2 text-xs text-warning-ink" title={model.message}>
            Demo mode: no fish model connected yet, so results are sample data.
          </p>
        )}
        {model && !model.demo && (
          <p className="rounded-md bg-sidebar-accent/40 px-3 py-2 text-xs" title={model.message}>
            {model.device === "gpu" ? "GPU mode" : "CPU mode (slower)"}
            {model.speciesModel ? ` · ${model.references ?? 0} reference pictures` : " · species model not installed"}
          </p>
        )}
        <div
          className="flex rounded-lg border border-sidebar-border p-0.5 text-xs"
          role="radiogroup"
          aria-label="Theme"
        >
          {(["light", "dark"] as const).map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={theme === t}
              onClick={() => setTheme(t)}
              className={`flex-1 rounded-md px-2 py-1.5 outline-none transition focus-visible:ring-2 focus-visible:ring-ring ${
                theme === t
                  ? "bg-card font-medium text-foreground shadow-sm"
                  : "text-sidebar-foreground/70 hover:text-sidebar-foreground"
              }`}
            >
              {t === "light" ? "☀ Light" : "☾ Dark"}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={switchPerson}
            disabled={busy}
            className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 text-left text-sm outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            title="Switch person"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
              {initials(person.name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{person.name}</span>
              <span className="block text-[11px] text-sidebar-foreground/60">Switch person</span>
            </span>
          </button>
          <button
            onClick={onShortcuts}
            className="rounded-md border border-sidebar-border px-2 py-1 text-xs text-sidebar-foreground/70 outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
            title="Keyboard shortcuts (?)"
          >
            ? Keys
          </button>
        </div>
        <div className="flex items-center gap-2 px-1 text-xs text-sidebar-foreground/60">
          <span className="h-2 w-2 rounded-full bg-success" aria-hidden /> Offline · nothing leaves this computer
        </div>
      </div>
    </aside>
  );
}
