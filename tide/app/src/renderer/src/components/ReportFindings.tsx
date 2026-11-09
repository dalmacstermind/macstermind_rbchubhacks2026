// "Findings" on the PDF report. The status lines only ever use a note a person made,
// so they are plain lines: no colour, no alert.
import type { SurveyReport } from "../../../shared/api";

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="r-kv">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function ReportFindings({ report }: { report: SurveyReport }) {
  const { videos } = report.results;
  return (
    <section className="r-section">
      <h2>Findings</h2>
      <div className="r-findings">
        <div className="r-grid">
          <div className="r-hero">
            <div className="r-hero-top">
              <div className="r-hero-label">Number of identified species</div>
              <div className="r-hero-num">{report.identifiedSpecies}</div>
            </div>
            <div className="r-split">
              <div>
                <b>{report.aiOnly}</b>
                <span>AI only</span>
              </div>
              <div>
                <b>{report.humanApproved}</b>
                <span>Human approved</span>
              </div>
            </div>
          </div>
          <div className="r-col">
            <Row label="Native (noted by staff)" value={report.nativeNoted} />
            <Row label="Invasive (noted by staff)" value={report.invasiveNoted} />
            {report.unusualNoted > 0 && <Row label="Unusual (noted by staff)" value={report.unusualNoted} />}
            <Row label="Status not noted" value={report.statusNotNoted} />
            <Row label="Unidentified fish" value={report.unidentifiedFish} />
            <Row label="Invertebrates" value={report.invertebrates} />
          </div>
          <div className="r-col">
            <Row label="Adult*" value="–" />
            <Row label="Juvenile*" value="–" />
          </div>
        </div>
        {videos.length > 0 && (
          <div className="r-means">
            <span className="r-means-title">MeanCount</span>
            {videos.map((v, i) => (
              <div className="r-mean" key={v.id}>
                <span>Video {i + 1}</span>
                {v.meanCount === null ? (
                  <span>Not counted yet</span>
                ) : (
                  <>
                    <b>{v.meanCount.toFixed(2)}</b>
                    {v.meanCountAi !== null && v.meanCountAi !== v.meanCount && (
                      <span>AI alone {v.meanCountAi.toFixed(2)}</span>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
