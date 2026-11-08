// The app shell: sidebar, who's working, theme, and which screen is showing.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileStatus, ModelStatus, Person, PickedFile, QcData, SurveyData } from "../../shared/api";
import { summarize, type Detection, type Species } from "../../shared/survey";
import { api } from "./api";
import { taskbarProgress, useCounts } from "./counts";
import { notifyDesktop } from "./notifications";
import { qcState, useOverview } from "./overview";
import { usePrefs } from "./prefs";
import { ShortcutsSheet, useKeys } from "./shortcuts";
import { AppTopBar } from "./components/AppTopBar";
import { CountingBanner } from "./components/CountingBanner";
import { StepTabs } from "./components/StepTabs";
import { ToolsSidebar } from "./components/ToolsSidebar";
import type { Page } from "./pages";
import { useTheme } from "./theme";
import { Alert, btnGhost, plural } from "./ui";
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

// Stands in for the person while "Who's working?" is open (see `locked` below).
const NOBODY: Person = { name: "", role: "" };

export default function App() {
  const [person, setPerson] = useState<Person | null>(null);
  const [theme, setTheme] = useTheme();
  const [prefs, setPrefs] = usePrefs();
  const [page, setPage] = useState<Page>("upload");
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [form, setForm] = useState<SurveyForm>(() => ({
    site: "",
    surveyDate: "",
    threshold: prefs.threshold,
    sampling: prefs.sampling,
    enhance: prefs.enhance,
    ignoreSpecks: prefs.ignoreSpecks,
    lookCloser: prefs.lookCloser,
    tracker: prefs.tracker,
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
  const [overview, reloadOverview] = useOverview(species);
  const counts = useCounts(prefs.notify, (id) => openFromNotification(id));

  useEffect(() => {
    void api.species.list().then(setSpecies);
    void api.model.status().then(setModel);
  }, []);
  useKeys({ "?": () => setShortcuts(true) }, !!person);

  // When a video of the open survey changes state (confirmed, counting, finished…), load the survey
  // again so "not counted yet" and the pictures are right on every screen, not only the Report.
  const openSurveyId = data?.survey.id;
  const openSurveyCounts = counts
    .filter((c) => c.surveyId === openSurveyId)
    .map((c) => `${c.videoId}:${c.state}`)
    .join();
  useEffect(() => {
    if (openSurveyId === undefined || !openSurveyCounts) return;
    void api.surveys.get(openSurveyId).then((fresh) => setData((d) => (d?.survey.id === openSurveyId ? fresh : d)));
  }, [openSurveyId, openSurveyCounts]);

  const summary = useMemo(
    () => (data ? summarize(data.frames, species, data.survey.threshold) : null),
    [data, species],
  );
  const qc = useMemo(() => (data && qcRaw ? qcState(data, qcRaw, species) : null), [data, qcRaw, species]);

  const go = (p: Page) => {
    if (p === "upload" || p === "qc" || p === "trends") void reloadOverview();
    if (p === "report" && data) void api.qc.get(data.survey.id).then(setQcRaw);
    if (p === "qc") setQcSurvey(null);
    setPage(p);
  };

  // Start fresh, like when the app first opens: close the current survey so steps 2–5 are greyed out
  // again, and clear the form. The closed survey stays saved and can be reopened from "Your surveys".
  const newSurvey = () => {
    setData(null);
    setQcRaw(null);
    setFinished(null);
    setReviewMode("all");
    setError(null);
    setFiles([]);
    setForm({ ...form, site: "", surveyDate: "" });
    go("upload");
  };

  const openSurvey = useCallback(async (id: number, target: OpenTarget = "report") => {
    const [d, q] = await Promise.all([api.surveys.get(id), api.qc.get(id)]);
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
    return d;
  }, []);

  // Clicking a desktop notification opens its survey. While files are being checked the other screens
  // are locked, so then the click only brings TIDE forward. A survey deleted since then just doesn't open.
  const pageNow = useRef(page);
  pageNow.current = page;
  const openFromNotification = (id: number) => {
    if (pageNow.current !== "processing") openSurvey(id).catch(() => undefined);
  };

  const start = async () => {
    if (!person) return;
    setError(null);
    setPage("processing");
    try {
      const r = await api.analysis.start({ ...form, person: person.name, files: files.map((f) => f.path) });
      setFiles([]);
      setForm({ ...form, site: "", surveyDate: "" });
      const opened = await openSurvey(r.surveyId);
      setFinished(r.files);
      if (prefs.notify) {
        const failed = r.files.filter((f) => f.state === "failed").length;
        const windows = opened.survey.windowsToConfirm;
        notifyDesktop(
          windows ? "TIDE: waiting for you" : "TIDE: files processed",
          windows
            ? `${form.site || "Your survey"}: confirm the analysis window of ${plural(windows, "video")} so TIDE can count the fish.`
            : `${form.site || "Your survey"} is ready${failed ? ` · ${plural(failed, "file")} couldn't be read` : ""}.`,
          () => openFromNotification(r.surveyId),
        );
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

  // Until someone picks their name, the app is shown blurred behind the "Who's working?" dialog and
  // can't be clicked, focused or used with the keyboard (`inert`). `who` fills in for the person so the
  // page behind can still be drawn; nothing can be saved under it because nothing behind can be used.
  const locked = !person;
  const who = person ?? NOBODY;

  const busy = page === "processing";
  // The taskbar icon follows the count, so it's visible with TIDE minimized. While files are being
  // checked that screen uses the taskbar itself, and this takes over again when it closes.
  const taskbar = taskbarProgress(counts);
  useEffect(() => {
    if (!busy) window.desktop.setProgress(taskbar);
  }, [busy, taskbar]);
  const failed = finished?.filter((f) => f.state !== "done") ?? [];
  // Videos are only counted after a person confirms their analysis window, so "finished" isn't the end.
  const windowsToConfirm = data?.survey.windowsToConfirm ?? 0;

  return (
    // The app frame (CLAUDE.md, App frame): the top bar across the top; below it, the Tools column on
    // the left and, on the right, the five step tabs above the current page.
    <>
      <div
        inert={locked}
        className={`flex h-screen flex-col bg-background text-foreground transition-[filter] duration-300 ${
          locked ? "pointer-events-none select-none blur-[6px]" : ""
        }`}
      >
        {shortcuts && <ShortcutsSheet onClose={() => setShortcuts(false)} />}
        <AppTopBar
          busy={busy}
          person={who}
          switchPerson={() => setPerson(null)}
          theme={theme}
          setTheme={setTheme}
          model={model}
          onShortcuts={() => setShortcuts(true)}
        />
        <div className="flex min-h-0 flex-1">
          <ToolsSidebar page={page} go={go} busy={busy} />
          <div className="flex min-w-0 flex-1 flex-col">
            <StepTabs
              page={page}
              go={go}
              busy={busy}
              hasSurvey={!!data}
              toCheck={summary ? summary.toReview + summary.toLabel : 0}
            />
            <CountingBanner counts={counts} busy={busy} onOpen={(id) => void openSurvey(id)} />
            <main className="min-h-0 flex-1 overflow-auto">
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
                        tone={failed.length || windowsToConfirm ? "warning" : "success"}
                        icon={failed.length || windowsToConfirm ? "⚠" : "✓"}
                        title={`${windowsToConfirm ? "One more step: no fish have been counted yet" : "Files processed"}${failed.length ? `, and ${plural(failed.length, "file")} couldn't be used` : ""}`}
                        action={
                          <button className={btnGhost} onClick={() => setFinished(null)}>
                            Dismiss
                          </button>
                        }
                      >
                        {failed.length
                          ? failed.map((f) => `${f.name}: ${f.detail}`).join(" · ")
                          : windowsToConfirm
                            ? `Confirm the analysis window of ${plural(windowsToConfirm, "video")} below. No fish are counted until you do.`
                            : `${plural(finished.length, "file")} processed.`}
                      </Alert>
                    </div>
                  )}
                  <ReportView
                    data={data}
                    summary={summary}
                    species={species}
                    qc={qc}
                    person={who}
                    onReview={(m) => {
                      setReviewMode(m);
                      setPage("review");
                    }}
                    onQc={() => {
                      setQcSurvey(data.survey.id);
                      setPage("qc");
                    }}
                    onChanged={() => void openSurvey(data.survey.id)}
                    onNewSurvey={newSurvey}
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
                  person={who}
                  edit={editDetection}
                  surveyId={data.survey.id}
                  onReload={() => void api.surveys.get(data.survey.id).then(setData)}
                  onBack={() => go("report")}
                />
              )}
              {page === "qc" && (
                <QcView
                  overview={overview}
                  species={species}
                  person={who}
                  surveyId={qcSurvey}
                  setSurveyId={(id) => {
                    setQcSurvey(id);
                    if (id === null) void reloadOverview();
                  }}
                  onChanged={() => data && void api.qc.get(data.survey.id).then(setQcRaw)}
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
                  person={who}
                  onChanged={() => void api.surveys.get(data.survey.id).then(setData)}
                />
              )}
              {page === "species" && <SpeciesView species={species} setSpecies={setSpecies} person={who} />}
              {page === "settings" && <SettingsView person={who} />}
            </main>
          </div>
        </div>
      </div>
      {locked && <WhoIsWorking onPick={setPerson} />}
    </>
  );
}
