// The end of the PDF report: anything still open, image counts, the files used, and how to read the numbers.
import type { SurveyReport } from "../../../shared/api";
import type { OpenItem } from "../../../shared/survey";
import { fileSize } from "../reportFormat";

export function ReportAppendix({ report, open }: { report: SurveyReport; open: OpenItem[] }) {
  const { images } = report.results;
  return (
    <>
      {open.length > 0 && (
        <section className="r-section">
          <h2>Still open</h2>
          <div className="r-card">
            <ul className="r-list">
              {open.map((o) => (
                <li key={o.key}>{o.text}</li>
              ))}
            </ul>
          </div>
        </section>
      )}
      {images.length > 0 && (
        <section className="r-section">
          <h2>Images (never part of MeanCount)</h2>
          <div className="r-findings">
            <table className="r-table">
              <colgroup>
                <col style={{ width: "55%" }} />
                <col />
                <col />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th>Image</th>
                  <th>Fish</th>
                  <th>Invertebrates</th>
                  <th>Unidentified</th>
                </tr>
              </thead>
              <tbody>
                {images.map((m) => (
                  <tr key={m.fileId}>
                    <td style={{ overflowWrap: "anywhere" }}>{m.relPath}</td>
                    <td>{m.totalFish}</td>
                    <td>{m.invertebrates}</td>
                    <td>{m.unknown}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="r-two">
        <section className="r-section">
          <h2>Input files</h2>
          <div className="r-card">
            {report.files.map((f, i) => (
              <div className="r-kv" key={`${f.name}-${i}`}>
                <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{f.name}</span>
                <span>{f.sizeBytes === null ? "–" : fileSize(f.sizeBytes)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="r-section">
          <h2>How to read this report</h2>
          <dl className="r-card r-help" style={{ margin: 0 }}>
            <dt>MeanCount</dt>
            <dd>Fish counted at the subsample points ÷ the number of points, for each video. Points with no fish are included.</dd>
            <dt>Total at points</dt>
            <dd>The sum across points. The same fish can appear at more than one point, so this isn't a count of individuals.</dd>
            <dt>Clarity index</dt>
            <dd>An estimate of how clear the water looks in the video. It isn't a turbidity measurement.</dd>
          </dl>
        </section>
      </div>
    </>
  );
}
