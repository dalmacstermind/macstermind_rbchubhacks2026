// The survey report. Headline numbers up top; survey details and QC are one click away.
import { useState } from "react";
import type { Person, SurveyData } from "../../../shared/api";
import {
  UNKNOWN,
  isSurveyComplete,
  openItems,
  type OpenItem,
  type Species,
  type SpeciesStatus,
  type Summary,
} from "../../../shared/survey";
import { api } from "../api";
import { ExportMenu } from "../components/ExportMenu";
import { MatchAgainButton } from "../components/MatchAgainButton";
import { CountProgress } from "../components/CountProgress";
import { NotCountedYet } from "../components/NotCountedYet";
import { ProtocolResults, type SurveyCountProgress } from "../components/ProtocolResults";
import { SurveyDoneCard } from "../components/SurveyDoneCard";
import { buildWorkbook } from "../exportXlsx";
import type { QcState } from "../overview";
import {
  Alert,
  Certainty,
  Chip,
  Disclosure,
  FUTURE_DATE_MESSAGE,
  Field,
  Header,
  Modal,
  Stat,
  StatusPill,
  btnGhost,
  btnLink,
  btnPrimary,
  plural,
  today,
} from "../ui";

export type ReviewMode = "all" | "review" | "label";

export function ReportView({
  data,
  summary: s,
  species,
  qc,
  person,
  onReview,
  onQc,
  onChanged,
  onNewSurvey,
  focusVideoId,
  onVideoFocused,
}: {
  data: SurveyData;
  summary: Summary;
  species: Species[];
  qc: QcState | null;
  person: Person;
  onReview: (mode: ReviewMode) => void;
  onQc: () => void;
  onChanged: () => void;
  onNewSurvey: () => void;
  focusVideoId: number | null; // scroll to this video's results (opened from Trends)
  onVideoFocused: () => void;
}) {
  const { survey, frames } = data;
  const [saved, setSaved] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [counting, setCounting] = useState<SurveyCountProgress | null>(null); // pictures come when counting is done
  const open = openItems(s, qc ?? undefined, survey);
  // Videos wait for a person before they're counted, so an empty report often means "not looked at yet".
  const nothingCounted = survey.videosToCount > 0 && frames.length === 0;
  const fishRows = s.rows.filter((r) => r.sp.kind !== "invertebrate");
  const invRows = s.rows.filter((r) => r.sp.kind === "invertebrate");
  const max = Math.max(1, ...s.rows.map((r) => r.maxN));
  const fileName = `TIDE - ${survey.site.replace(/[\\/:*?"<>|]/g, "-")}${open.length ? " (draft)" : ""}`;
  const names = (status: SpeciesStatus) =>
    s.rows
      .filter((r) => r.sp.status === status)
      .map((r) => r.sp.common)
      .join(", ");

  const exportXlsx = async () => {
    setChecking(false);
    // The Videos sheet needs each video's analysis window; the Points and Images sheets need the results.
    const [videos, results] = await Promise.all([
      api.surveys.videos(survey.id),
      api.surveys.results(survey.id).catch(() => null),
    ]);
    const buf = await buildWorkbook({ data, summary: s, species, open, videos, person: person.name, results });
    const path = await window.desktop.saveXlsx(fileName, buf);
    if (path) setSaved(path);
  };
  const exportPdf = async () => {
    const path = await window.desktop.savePdf(fileName);
    if (path) setSaved(path);
  };
  const go = (item: OpenItem) => {
    if (item.key === "qc") onQc();
    else if (item.key === "window" || item.key === "count")
      document.getElementById("protocol-results")?.scrollIntoView({ behavior: "smooth" });
    else onReview(item.key);
  };

  return (
    <>
      {checking && (
        <ExportCheck
          title={survey.site}
          items={open}
          onGo={(i) => {
            setChecking(false);
            go(i);
          }}
          onExport={exportXlsx}
          onClose={() => setChecking(false)}
        />
      )}
      {editing && <EditSurvey data={data} onClose={() => setEditing(false)} onSaved={onChanged} />}
      <Header eyebrow={`Step 2 of 4 · ${survey.site}`} title="Counting">
        <MatchAgainButton surveyId={survey.id} onDone={onChanged} />
        <button onClick={() => onReview("all")} className={btnGhost}>
          Approve Findings
        </button>
        <ExportMenu
          onExcel={() => (open.length ? setChecking(true) : void exportXlsx())}
          onPdf={() => void exportPdf()}
          disabled={counting !== null}
        />
      </Header>
      <div className="space-y-6 px-10 py-8">
        {saved && (
          <div className="flex items-center justify-between rounded-xl border border-success/40 bg-success/10 px-5 py-3 text-sm print:hidden">
            <span>
              Saved to <b>{saved}</b>
            </span>
            <button className={btnLink} onClick={() => window.desktop.openPath(saved)}>
              Open it
            </button>
          </div>
        )}
        {isSurveyComplete(open) && <SurveyDoneCard exported={!!saved} onNewSurvey={onNewSurvey} />}
        {s.toReview > 0 && (
          <Alert
            tone="warning"
            icon="?"
            title={`${s.toReview} possible fish ${s.toReview === 1 ? "needs you to check it" : "need you to check them"}`}
            action={
              <button onClick={() => onReview("review")} className={`${btnPrimary} print:hidden`}>
                Check them now
              </button>
            }
          >
            TIDE wasn't sure enough to count {s.toReview === 1 ? "it, so it's" : "these, so they're"}{" "}
            <b>not included</b> in the numbers below until you confirm {s.toReview === 1 ? "it" : "them"}.
          </Alert>
        )}
        {s.invasive > 0 && (
          <Alert tone="danger" icon="!" title={`Invasive species found: ${names("invasive")}`}>
            Consider reporting this sighting to your provincial fisheries contact.
          </Alert>
        )}
        {s.unusual > 0 && (
          <Alert tone="info" icon="↑" title={`Unusual visitor spotted: ${names("unusual")}`}>
            This species isn't normally found in Nova Scotia waters. It may be arriving with warmer water.
          </Alert>
        )}

        <ProtocolResults
          surveyId={survey.id}
          species={species}
          person={person}
          onCountingDone={onChanged}
          onCountingChange={setCounting}
          focusVideoId={focusVideoId}
          onVideoFocused={onVideoFocused}
          version={frames.reduce((n, f) => n + f.detections.filter((d) => d.verified).length, frames.length)}
        />

        {nothingCounted && counting ? (
          <div className="rounded-2xl border border-border bg-card p-10">
            <div className="mx-auto max-w-md">
              <CountProgress
                state={counting.state}
                percent={counting.percent}
                detail={counting.detail}
                etaS={counting.etaS}
                size={112}
              />
              <p className="mt-4 text-center text-sm text-muted-foreground">
                The pictures and their fish appear here when counting is done.
              </p>
            </div>
          </div>
        ) : nothingCounted ? (
          <NotCountedYet survey={survey} />
        ) : (
          <>
            <div>
              <h2 className="font-display text-xl font-semibold">Picture-by-picture counts</h2>
              <p className="text-sm text-muted-foreground">
                The most fish of each species seen in one picture (MaxN). An optional extra: the protocol figures are
                above.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
              <Stat label="Fish counted" value={s.total} sub={`${s.sightings} sightings in total`} />
              <Stat
                label="Fish species"
                value={s.speciesCount}
                sub={s.toLabel ? `+ ${s.toLabel} not yet identified` : undefined}
              />
              <Stat
                label="Checked by people"
                value={`${Math.round((s.confirmed / Math.max(1, frames.flatMap((f) => f.detections).length)) * 100)}%`}
                sub={s.checkedBy.length ? `by ${s.checkedBy.join(", ")}` : "AI only so far"}
              />
            </div>

            {s.rows.length === 0 ? (
              <div className="rounded-2xl border border-border bg-card p-10 text-center text-muted-foreground">
                {s.toReview > 0
                  ? "No fish counted yet. Check the possible fish above to add them to the counts."
                  : survey.videosToCount > 0
                    ? `No fish so far, but ${plural(survey.videosToCount, "video")} still ${survey.videosToCount === 1 ? "hasn't" : "haven't"} been counted.`
                    : frames.length === 0
                      ? "TIDE didn't look at any pictures in this survey, so there's nothing to show."
                      : "No fish were found in this footage."}
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-6 py-3">Species</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="w-1/3 px-6 py-3">Counted</th>
                      <th className="px-6 py-3">Sightings</th>
                      <th className="px-6 py-3">How sure</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...fishRows, ...invRows].map((r, i) => (
                      <tr
                        key={r.sp.id}
                        className={`border-t border-border ${i === fishRows.length && i > 0 ? "border-t-2" : ""}`}
                      >
                        <td className="px-6 py-4">
                          <div className="font-medium">
                            {r.sp.common}
                            {r.sp.kind === "invertebrate" && (
                              <span className="ml-2 text-xs font-normal text-muted-foreground">invertebrate</span>
                            )}
                          </div>
                          <div className="text-xs italic text-muted-foreground">{r.sp.scientific}</div>
                        </td>
                        <td className="px-6 py-4">
                          {r.sp.id === UNKNOWN ? (
                            <button className="outline-none" onClick={() => onReview("label")}>
                              <Chip tone="review">Not identified →</Chip>
                            </button>
                          ) : (
                            <StatusPill status={r.sp.status} />
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <span className="w-6 font-display text-lg font-semibold">{r.maxN}</span>
                            <div className="h-2 flex-1 rounded-full bg-secondary">
                              <div
                                className={`h-full rounded-full ${
                                  r.sp.status === "invasive"
                                    ? "bg-destructive"
                                    : r.sp.status === "unusual"
                                      ? "bg-warning"
                                      : "bg-gradient-ocean"
                                }`}
                                style={{ width: `${(r.maxN / max) * 100}%` }}
                              />
                            </div>
                          </div>
                          {r.corrected > 0 && (
                            <div className="mt-1 text-xs text-primary">{r.corrected} corrected by people</div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-muted-foreground">{r.sightings}</td>
                        <td className="px-6 py-4">
                          <Certainty value={r.conf} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <Disclosure label="How fish are counted">
          <div className="rounded-xl bg-secondary/50 px-5 py-4 text-sm text-muted-foreground">
            The same fish often shows up in many pictures as it swims past. To avoid counting it twice, TIDE uses the{" "}
            <b className="text-foreground">most fish of each species seen in a single picture</b> (known as MaxN, the
            standard count for video surveys). “Sightings” is every time it was spotted. Invertebrates such as crabs are
            counted separately from fish.
          </div>
        </Disclosure>

        <Disclosure label="Survey details and quality check">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5 text-sm">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold">Survey</span>
                <button className={btnLink} onClick={() => setEditing(true)}>
                  Edit
                </button>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted-foreground">
                <dt>Date filmed</dt>
                <dd className="text-foreground">{survey.surveyDate || "Not recorded"}</dd>
                <dt>Analysed</dt>
                <dd className="text-foreground">
                  {survey.createdAt}
                  {survey.createdBy && ` by ${survey.createdBy}`}
                </dd>
                <dt>Footage</dt>
                <dd className="text-foreground">{survey.files.join(", ")}</dd>
                <dt>Counted at</dt>
                <dd className="text-foreground">{Math.round(survey.threshold * 100)}% certainty or higher</dd>
                <dt>Protocol</dt>
                <dd className="text-foreground">
                  {survey.protocol.lengthS / 60}-min window, a point every {survey.protocol.intervalS} s (
                  {survey.protocol.pointsPerWindow} points), ±{survey.protocol.contextS} s context, counted within ±
                  {survey.protocol.toleranceS} s
                  {!survey.protocolRecorded && (
                    <div className="text-xs text-muted-foreground">
                      Protocol values weren't recorded for this survey; these are the defaults.
                    </div>
                  )}
                </dd>
                {s.invertebrates > 0 && (
                  <>
                    <dt>Invertebrates</dt>
                    <dd className="text-foreground">{s.invertebrates}</dd>
                  </>
                )}
                {s.clarity !== null && (
                  <>
                    <dt>Water clarity</dt>
                    <dd className="text-foreground">{Math.round(s.clarity)} / 100 (estimate)</dd>
                  </>
                )}
              </dl>
            </div>
            <div className="rounded-xl border border-border bg-card p-5 text-sm">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold">Blind quality check</span>
                <button className={btnLink} onClick={onQc}>
                  {qc && qc.done ? "Continue" : "Start"}
                </button>
              </div>
              {qc ? (
                <p className="text-muted-foreground">
                  {qc.done} of {qc.total} sample pictures recounted by a second person.
                  {qc.agreement !== null && (
                    <>
                      {" "}
                      Agreement <b className="text-foreground">{Math.round(qc.agreement)}%</b> (target {qc.target}%).
                    </>
                  )}
                </p>
              ) : (
                <p className="text-muted-foreground">Loading…</p>
              )}
            </div>
          </div>
        </Disclosure>
      </div>
    </>
  );
}

/** Runs before exporting when anything is still open. Never blocks: "Export anyway" is always there. */
function ExportCheck({
  title,
  items,
  onGo,
  onExport,
  onClose,
}: {
  title: string;
  items: OpenItem[];
  onGo: (i: OpenItem) => void;
  onExport: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={`Before you export · ${title}`}
      onClose={onClose}
      footer={
        <>
          <button className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button className={btnGhost} onClick={() => onGo(items[0]!)}>
            Go to first issue
          </button>
          <button className={btnPrimary} onClick={onExport}>
            Export anyway
          </button>
        </>
      }
    >
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.key} className="flex items-center justify-between gap-4 text-sm">
            <span className="flex items-center gap-2">
              <span className="text-warning-ink" aria-hidden>
                ⚠
              </span>
              {i.text}
            </span>
            <button className={btnLink} onClick={() => onGo(i)}>
              {i.key === "qc" ? "QC" : i.key === "label" ? "Name them" : i.key === "review" ? "Check" : "Show me"} →
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">
        Exporting now marks the file “Draft” and lists these on its “Read me” sheet.
      </p>
    </Modal>
  );
}

export function EditSurvey({ data, onClose, onSaved }: { data: SurveyData; onClose: () => void; onSaved: () => void }) {
  const [site, setSite] = useState(data.survey.site);
  const [date, setDate] = useState(data.survey.surveyDate);
  const [sure, setSure] = useState(Math.round(data.survey.threshold * 100));
  const [error, setError] = useState("");
  const save = async () => {
    if (date > today()) return setError(FUTURE_DATE_MESSAGE);
    try {
      await api.surveys.update(data.survey.id, { site, surveyDate: date, threshold: sure / 100 });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title="Edit survey"
      onClose={onClose}
      footer={
        <>
          <button className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button className={btnPrimary} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Site name">
          <input className="input" value={site} onChange={(e) => setSite(e.target.value)} />
        </Field>
        <Field label="Date filmed">
          <input
            type="date"
            className="input"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label={`Count a fish automatically when TIDE is at least ${sure}% sure`}>
          <input
            type="range"
            min={10}
            max={95}
            step={5}
            className="w-full"
            value={sure}
            onChange={(e) => setSure(Number(e.target.value))}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Less sure finds wait for a person in "Approve Findings". Counts update straight away.
          </p>
        </Field>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </Modal>
  );
}
