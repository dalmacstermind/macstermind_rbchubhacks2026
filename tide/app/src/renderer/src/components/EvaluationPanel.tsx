// Settings → Accuracy check: compares the AI's fish counts with hand counts from a CSV, the way the
// protocol measures a person (per-point % difference, share of points within the QC limit, MeanCount
// difference, zero-point agreement). Numbers come from the back end; nothing is calculated here.
import { useEffect, useState } from "react";
import type { Evaluation, SurveyInfo } from "../../../shared/api";
import { api } from "../api";
import { Field, Modal, btnGhost, btnPrimary } from "../ui";

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

export function EvaluationPanel() {
  const [surveys, setSurveys] = useState<SurveyInfo[] | null>(null);
  const [surveyId, setSurveyId] = useState("");
  const [result, setResult] = useState<Evaluation | null>(null);
  const [error, setError] = useState("");

  // Only surveys with something counted can be compared. The newest is listed first.
  useEffect(() => {
    api.surveys
      .list()
      .then((all) => {
        const counted = all.filter((s) => s.frameCount > 0);
        setSurveys(counted);
        setSurveyId(String(counted[0]?.id ?? ""));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const compare = async () => {
    setError("");
    try {
      const path = await window.desktop.pickCsv();
      if (path) setResult(await api.surveys.evaluate(Number(surveyId), path));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!surveys) return error ? <p className="text-sm text-destructive">{error}</p> : null;
  if (!surveys.length) return <p className="text-sm text-muted-foreground">No counted surveys yet.</p>;
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Compare TIDE's fish counts at each point with counts made by hand. Choose a CSV file with the columns video,
        point and total_fish.
      </p>
      <Field label="Survey">
        <select className="input" value={surveyId} onChange={(e) => setSurveyId(e.target.value)}>
          {surveys.map((s) => (
            <option key={s.id} value={s.id}>
              {`Survey ${s.id}: ${s.site}${s.surveyDate ? ` · ${s.surveyDate}` : ""}`}
            </option>
          ))}
        </select>
      </Field>
      <button className={btnGhost} onClick={() => void compare()}>
        Compare with hand counts…
      </button>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {result && <EvaluationResult result={result} onClose={() => setResult(null)} />}
    </>
  );
}

function EvaluationResult({ result, onClose }: { result: Evaluation; onClose: () => void }) {
  return (
    <Modal
      title="AI compared with hand counts"
      onClose={onClose}
      wide
      footer={
        <button className={btnPrimary} onClick={onClose}>
          Close
        </button>
      }
    >
      <p className="text-sm text-muted-foreground">
        Reference: {result.source}. {result.pointsCompared} points compared.
        {result.unmatchedHuman.length > 0 && ` ${result.unmatchedHuman.length} hand counts had no matching point.`}
      </p>
      {result.pointsCompared === 0 ? (
        <p className="mt-3 text-sm">
          Nothing to compare: none of the hand counts match a counted point in this survey. Check the video names and
          point numbers in the CSV.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <Metric label={`Points within ${result.maxPctDiff}%`} value={pct(result.shareWithin)} />
            <Metric label="Mean difference (fish/point)" value={String(result.meanAbsDiff ?? "–")} />
            <Metric label="Zero-point agreement" value={pct(result.zeroAgreement)} />
            <Metric
              label={`Meets ${Math.round(result.minAgreement * 100)}% agreement`}
              value={result.meetsAgreement ? "Yes" : "No"}
            />
          </div>
          <table className="mt-4 w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-1">Video</th>
                <th>Points</th>
                <th>MeanCount AI</th>
                <th>MeanCount human</th>
                <th>Within limit</th>
              </tr>
            </thead>
            <tbody>
              {result.videos.map((v) => (
                <tr key={v.video} className="border-t border-border">
                  <td className="py-1">{v.video}</td>
                  <td>{v.points}</td>
                  <td>{v.meanCountAi}</td>
                  <td>{v.meanCountHuman}</td>
                  <td>{pct(v.shareWithin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">
            Measured numbers only. Don't evaluate on videos whose fish were used as reference pictures.
          </p>
        </>
      )}
    </Modal>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/30 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-xl font-semibold">{value}</div>
    </div>
  );
}
