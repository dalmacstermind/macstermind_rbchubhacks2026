// "Compare with hand counts": measures the AI the way the protocol measures a person (per-point %
// difference, share of points within the QC limit, MeanCount difference, zero-point agreement).
// Numbers come from the back end; nothing is calculated here.
import { useState } from "react";
import type { Evaluation } from "../../../shared/api";
import { api } from "../api";
import { Modal, btnGhost, btnPrimary } from "../ui";

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

export function EvaluationPanel({ surveyId }: { surveyId: number }) {
  const [result, setResult] = useState<Evaluation | null>(null);
  const [error, setError] = useState("");

  const run = async (fromCsv: boolean) => {
    setError("");
    try {
      const path = fromCsv ? await window.desktop.pickCsv() : undefined;
      if (fromCsv && !path) return;
      setResult(await api.surveys.evaluate(surveyId, path ?? undefined));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <button className={btnGhost} onClick={() => void run(false)} title="Points staff reviewed are the reference">
        Measure against reviewed points
      </button>
      <button className={btnGhost} onClick={() => void run(true)} title="CSV with columns video, point, total_fish">
        Compare with hand counts…
      </button>
      {result && (
        <Modal
          title="AI compared with hand counts"
          onClose={() => setResult(null)}
          wide
          footer={
            <button className={btnPrimary} onClick={() => setResult(null)}>
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
              Nothing to compare yet: review some points first, or choose a CSV of hand counts.
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
      )}
    </div>
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
