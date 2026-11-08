// The app shell: sidebar, who's working, theme, and which screen is showing.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FileStatus, ModelStatus, Person, PickedFile, QcData, SurveyData } from "../../shared/api";
import { summarize, type Detection, type Species } from "../../shared/survey";
import { api } from "./api";
import { qcState, useOverview } from "./overview";
import { usePrefs } from "./prefs";
import { ShortcutsSheet, useKeys } from "./shortcuts";
import { AppTopBar } from "./components/AppTopBar";
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

  useEffect(() => {
    void api.species.list().then(setSpecies);
    void api.model.status().then(setModel);
  }, []);
  useKeys({ "?": () => setShortcuts(true) }, !!person);

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
  }, []);
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
    // The app frame (CLAUDE.md, App frame): the top bar across the top; below it, the Tools column on
    // the left and, on the right, the five step tabs above the current page.
    <div className="flex h-screen flex-col bg-background text-foreground">
      {shortcuts && <ShortcutsSheet onClose={() => setShortcuts(false)} />}
      <AppTopBar
        busy={busy}
        person={person}
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
                person={person}
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
                person={person}
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
                person={person}
                onChanged={() => void api.surveys.get(data.survey.id).then(setData)}
              />
            )}
            {page === "species" && <SpeciesView species={species} setSpecies={setSpecies} person={person} />}
            {page === "settings" && <SettingsView person={person} />}
          </main>
        </div>
      </div>
    </div>
  );
}
