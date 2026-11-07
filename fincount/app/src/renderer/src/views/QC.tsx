// Blind quality check: a second person recounts a random sample of pictures with FinCount's
// boxes and counts hidden, then sees how far apart the two counts are.
import { useCallback, useEffect, useState } from "react";
import type { Person, QcData, SurveyData } from "../../../shared/api";
import { frameCounts, qcDifference, type Species } from "../../../shared/survey";
import { api } from "../api";
import { qcState, type SurveyOverview } from "../overview";
import type { Prefs } from "../prefs";
import { useKeys } from "../shortcuts";
import { Alert, Chip, Header, Kbd, btnGhost, btnPrimary, plural } from "../ui";

export function QcView({
  overview,
  species,
  prefs,
  person,
  surveyId,
  setSurveyId,
  onChanged,
}: {
  overview: SurveyOverview[] | null;
  species: Species[];
  prefs: Prefs;
  person: Person;
  surveyId: number | null;
  setSurveyId: (id: number | null) => void;
  onChanged: () => void;
}) {
  if (surveyId !== null)
    return (
      <QcCounting
        surveyId={surveyId}
        species={species}
        prefs={prefs}
        person={person}
        onBack={() => setSurveyId(null)}
        onChanged={onChanged}
      />
    );
  return (
    <>
      <Header eyebrow="Tools" title="Blind quality check" />
      <div className="max-w-4xl space-y-4 px-10 py-8">
        <p className="text-sm text-muted-foreground">
          A second person recounts {prefs.qcPercent}% of each survey's pictures without seeing FinCount's boxes or
          counts. Counts more than {prefs.qcMaxDiff}% apart are flagged for a recount. The goal is {prefs.qcTarget}%
          agreement.
        </p>
        {!overview ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : !overview.length ? (
          <p className="text-muted-foreground">No surveys yet. Count some footage first.</p>
        ) : (
          <div className="rounded-2xl border border-border bg-card">
            {overview.map((o) => {
              const { qc } = o;
              const done = qc.done >= qc.total;
              return (
                <div
                  key={o.data.survey.id}
                  className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5 last:border-0"
                >
                  <div>
                    <div className="font-medium">{o.data.survey.site}</div>
                    <div className="text-xs text-muted-foreground">
                      {qc.done} of {plural(qc.total, "sample picture")} recounted
                      {qc.agreement !== null && ` · agreement ${Math.round(qc.agreement)}%`}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {done ? (
                      qc.agreement !== null && qc.agreement >= qc.target ? (
                        <Chip tone="done">Meets target</Chip>
                      ) : (
                        <Chip tone="review">Below {qc.target}% target</Chip>
                      )
                    ) : qc.done ? (
                      <Chip tone="working">In progress</Chip>
                    ) : (
                      <Chip tone="waiting">Not started</Chip>
                    )}
                    <button className={done ? btnGhost : btnPrimary} onClick={() => setSurveyId(o.data.survey.id)}>
                      {done ? "Review" : qc.done ? "Continue" : "Start"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function QcCounting({
  surveyId,
  species,
  prefs,
  person,
  onBack,
  onChanged,
}: {
  surveyId: number;
  species: Species[];
  prefs: Prefs;
  person: Person;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<SurveyData | null>(null);
  const [qc, setQc] = useState<QcData | null>(null);
  const [idx, setIdx] = useState(0);
  const [fish, setFish] = useState(0);
  const [inv, setInv] = useState(0);
  const [result, setResult] = useState<{
    you: { fish: number; inv: number };
    app: { fish: number; invertebrates: number };
  } | null>(null);
  const [view, setView] = useState({ brightness: 100, contrast: 100 });
  const [ignoreWarning, setIgnoreWarning] = useState(false);

  const load = useCallback(async () => {
    const [d, q] = await Promise.all([api.surveys.get(surveyId), api.qc.get(surveyId, prefs.qcPercent)]);
    setData(d);
    setQc(q);
    const mine = new Set(q.counts.filter((c) => c.person === person.name).map((c) => c.frameId));
    const next = q.sample.findIndex((id) => !mine.has(id));
    setIdx(next === -1 ? q.sample.length : next);
  }, [surveyId, prefs.qcPercent, person.name]);
  useEffect(() => {
    void load();
  }, [load]);

  const frameId = qc?.sample[idx];
  const frame = data?.frames.find((f) => f.id === frameId);
  const finished = qc !== null && idx >= qc.sample.length;

  const submit = async () => {
    if (!frame || !data || result) return;
    const q = await api.qc.add(surveyId, prefs.qcPercent, {
      frameId: frame.id,
      person: person.name,
      fish,
      invertebrates: inv,
    });
    setQc(q);
    setResult({ you: { fish, inv }, app: frameCounts(frame, species, data.survey.threshold) });
    onChanged();
  };
  const next = () => {
    setResult(null);
    setFish(0);
    setInv(0);
    setIdx(idx + 1);
  };

  useKeys({
    ArrowUp: () => !result && setFish(fish + 1),
    ArrowDown: () => !result && setFish(Math.max(0, fish - 1)),
    Enter: () => (result ? next() : void submit()),
  });

  if (!data || !qc) return <div className="p-10 text-muted-foreground">Loading…</div>;
  const state = qcState(data, qc, species, prefs);
  const touchedBefore =
    data.survey.createdBy === person.name ||
    data.frames.some((f) => f.detections.some((d) => d.editedBy === person.name));

  return (
    <>
      <Header
        eyebrow={`Blind quality check · ${data.survey.site}`}
        title={finished ? "All sample pictures counted" : `Picture ${idx + 1} of ${qc.sample.length}`}
      >
        <div className="mr-2 text-sm text-muted-foreground">
          Agreement so far:{" "}
          <b className="text-foreground">{state.agreement === null ? "—" : `${Math.round(state.agreement)}%`}</b>{" "}
          (target {prefs.qcTarget}%)
        </div>
        <button className={btnGhost} onClick={onBack}>
          Back to list
        </button>
      </Header>
      <div className="px-10 py-6">
        {touchedBefore && !ignoreWarning && !finished && (
          <div className="mb-5">
            <Alert
              tone="warning"
              icon="!"
              title={`${person.name}, you've already worked on this survey`}
              action={
                <button className={btnGhost} onClick={() => setIgnoreWarning(true)}>
                  Continue anyway
                </button>
              }
            >
              A blind check works best when someone else does it. You can switch person from the bottom of the sidebar.
            </Alert>
          </div>
        )}
        {finished ? (
          <div className="max-w-xl space-y-4">
            <Alert
              tone={state.agreement !== null && state.agreement >= prefs.qcTarget ? "success" : "warning"}
              icon={state.agreement !== null && state.agreement >= prefs.qcTarget ? "✓" : "⚠"}
              title={`Agreement ${state.agreement === null ? "—" : `${Math.round(state.agreement)}%`} (target ${prefs.qcTarget}%)`}
            >
              {state.agreement !== null && state.agreement >= prefs.qcTarget
                ? "This survey meets the quality target."
                : "Below target. Pictures more than " +
                  prefs.qcMaxDiff +
                  "% apart should be recounted by another person."}
            </Alert>
            <button className={btnPrimary} onClick={onBack}>
              Done
            </button>
          </div>
        ) : (
          frame && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
              <div>
                <div className="overflow-hidden rounded-2xl border border-border bg-card">
                  <img
                    src={frame.image}
                    alt="Sample picture to count"
                    className="block w-full"
                    style={{ filter: `brightness(${view.brightness}%) contrast(${view.contrast}%)` }}
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
                  <span className="text-xs">FinCount's boxes and counts are hidden.</span>
                  <label className="flex items-center gap-2">
                    Brightness
                    <input
                      type="range"
                      min={50}
                      max={200}
                      step={5}
                      value={view.brightness}
                      onChange={(e) => setView({ ...view, brightness: +e.target.value })}
                      className="w-28 accent-primary"
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    Contrast
                    <input
                      type="range"
                      min={50}
                      max={200}
                      step={5}
                      value={view.contrast}
                      onChange={(e) => setView({ ...view, contrast: +e.target.value })}
                      className="w-28 accent-primary"
                    />
                  </label>
                </div>
              </div>
              <div className="space-y-4">
                <div className="rounded-2xl border border-border bg-card p-5">
                  <div className="mb-4 font-display text-lg font-semibold">Your count</div>
                  <Counter label="Fish" value={fish} set={setFish} disabled={!!result} />
                  <Counter label="Invertebrates (e.g. crabs)" value={inv} set={setInv} disabled={!!result} />
                  {!result && (
                    <button className={`${btnPrimary} mt-5 w-full`} onClick={submit}>
                      Submit count <Kbd>Enter</Kbd>
                    </button>
                  )}
                </div>
                {result && (
                  <QcResult
                    result={result}
                    maxDiff={prefs.qcMaxDiff}
                    onNext={next}
                    last={idx + 1 >= qc.sample.length}
                  />
                )}
              </div>
            </div>
          )
        )}
      </div>
    </>
  );
}

function Counter({
  label,
  value,
  set,
  disabled,
}: {
  label: string;
  value: number;
  set: (n: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <button
          className={`${btnGhost} h-9 w-9 p-0`}
          disabled={disabled || value === 0}
          onClick={() => set(value - 1)}
          aria-label={`One fewer: ${label}`}
        >
          −
        </button>
        <span className="w-10 text-center font-display text-2xl font-semibold" aria-live="polite">
          {value}
        </span>
        <button
          className={`${btnGhost} h-9 w-9 p-0`}
          disabled={disabled}
          onClick={() => set(value + 1)}
          aria-label={`One more: ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

function QcResult({
  result,
  maxDiff,
  onNext,
  last,
}: {
  result: { you: { fish: number; inv: number }; app: { fish: number; invertebrates: number } };
  maxDiff: number;
  onNext: () => void;
  last: boolean;
}) {
  const df = qcDifference(result.you.fish, result.app.fish);
  const di = qcDifference(result.you.inv, result.app.invertebrates);
  const ok = df <= maxDiff && di <= maxDiff;
  return (
    <div
      className={`rounded-2xl border p-5 ${ok ? "border-success/40 bg-success/10" : "border-warning/50 bg-warning/10"}`}
    >
      <div className="mb-2 font-semibold">{ok ? "✓ Your count agrees" : `⚠ More than ${maxDiff}% apart`}</div>
      <dl className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 text-sm">
        <dt />
        <dd className="text-xs text-muted-foreground">You</dd>
        <dd className="text-xs text-muted-foreground">FinCount</dd>
        <dt>Fish</dt>
        <dd className="text-right font-semibold">{result.you.fish}</dd>
        <dd className="text-right">{result.app.fish}</dd>
        <dt>Invertebrates</dt>
        <dd className="text-right font-semibold">{result.you.inv}</dd>
        <dd className="text-right">{result.app.invertebrates}</dd>
      </dl>
      {!ok && <p className="mt-3 text-sm text-muted-foreground">Ask another person to recount this picture.</p>}
      <button className={`${btnPrimary} mt-4 w-full`} onClick={onNext}>
        {last ? "Finish" : "Next picture"} <Kbd>Enter</Kbd>
      </button>
    </div>
  );
}
