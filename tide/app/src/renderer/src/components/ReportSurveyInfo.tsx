// "Survey info", "Water info" and "Analysis window" on the PDF report. Videos are numbered Video 1, Video 2, …
// the same way everywhere on the report.
import type { SurveyInfo, SurveyReport } from "../../../shared/api";
import { fileSize, fileTypes, joined, niceDate } from "../reportFormat";
import { mmss } from "./WindowConfirm";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="r-kv">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function ReportSurveyInfo({
  survey,
  report,
  modelName,
}: {
  survey: SurveyInfo;
  report: SurveyReport;
  modelName: string;
}) {
  const { videos } = report.results;
  const sizes = report.files.map((f) => f.sizeBytes);
  const known = sizes.every((s) => s !== null) && sizes.length > 0;
  const total = sizes.reduce<number>((sum, s) => sum + (s ?? 0), 0);
  const places = videos.map((v) => [v.transect, v.stat].filter(Boolean).join(" / "));
  const { intervalS, pointsPerWindow, toleranceS } = survey.protocol;

  return (
    <>
      <section className="r-section">
        <h2>Survey info</h2>
        <div className="r-card r-two">
          <div>
            <Row label="Surveyor" value={survey.createdBy || "Not recorded"} />
            <Row label="Survey #" value={String(survey.id)} />
            <Row label="Survey site" value={survey.site} />
            <Row label="Survey date" value={niceDate(survey.surveyDate)} />
          </div>
          <div>
            <Row label="Input file(s)" value={String(report.files.length)} />
            <Row label="Input file type(s)" value={fileTypes(report.files.map((f) => f.name))} />
            <Row label="Input file size" value={known ? fileSize(total) : "Not recorded"} />
            <Row label="Transect / STAT" value={joined(places, "Not read")} />
            <Row label="Model (at export)" value={modelName} />
          </div>
        </div>
      </section>

      {videos.length > 0 && (
        <div className="r-pair">
          <section className="r-section">
            <h2>Water info</h2>
            <div className="r-card">
              {videos.map((v, i) => (
                <div key={v.id}>
                  {videos.length > 1 && <div className="r-sub">Video {i + 1}</div>}
                  <div className="r-kv">
                    <span>Visibility</span>
                    <span>
                      {v.visibility ?? "–"}
                      {v.visibility && (
                        <span className="r-tagline">{v.visibilityConfirmed ? "Confirmed" : "Suggested"}</span>
                      )}
                    </span>
                  </div>
                  <Row label="Clarity index (estimate)" value={v.clarityIndex === null ? "–" : `${Math.round(v.clarityIndex)} / 100`} />
                </div>
              ))}
            </div>
          </section>
          <section className="r-section">
            <h2>Analysis window (only for videos)</h2>
            <div className="r-card">
              {videos.map((v, i) => (
                <div key={v.id}>
                  <div className="r-sub">
                    Video {i + 1}: {v.name} {v.confirmedBy && <small>confirmed by {v.confirmedBy}</small>}
                  </div>
                  <Row
                    label="Starts after / ends before"
                    value={v.windowStartS === null ? "Not confirmed" : `${mmss(v.windowStartS)} / ${mmss(v.windowEndS ?? 0)}`}
                  />
                </div>
              ))}
              <Row label="Subsampling" value={`${pointsPerWindow} points, 1 every ${intervalS} s, counted within ±${toleranceS} s`} />
            </div>
          </section>
        </div>
      )}
    </>
  );
}
