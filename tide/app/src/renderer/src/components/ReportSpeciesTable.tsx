// The species list on the PDF report: one row per identified species, with its best picture.
// The header row repeats on each page.
import { useState } from "react";
import type { ReportSpecies, SurveyReport } from "../../../shared/api";

function Picture({ s }: { s: ReportSpecies }) {
  // The crop from this survey first, then the registry's reference picture, then a plain fish outline.
  const sources = [s.picture, s.referencePicture].filter((u): u is string => !!u);
  const [failed, setFailed] = useState(0);
  const src = sources[failed];
  return (
    <div className="r-pic">
      {src ? (
        <img src={src} alt="" onError={() => setFailed(failed + 1)} />
      ) : (
        <svg width="30" height="18" viewBox="0 0 30 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M1 9c5-7 13-8 20-1l7-5-2 6 2 6-7-5c-7 7-15 6-20-1z" strokeLinejoin="round" />
          <circle cx="7" cy="8" r="0.8" fill="currentColor" />
        </svg>
      )}
    </div>
  );
}

export function ReportSpeciesTable({ report }: { report: SurveyReport }) {
  const hasImages = report.results.images.length > 0;
  const most = Math.max(1, ...report.species.map((s) => s.totalAtPoints));
  return (
    <section style={{ marginTop: 14 }}>
      <div className="r-findings">
        {report.species.length === 0 ? (
          <div style={{ padding: 16 }} className="r-empty">
            No species have been identified in this survey yet.
          </div>
        ) : (
          <table className="r-table">
            <colgroup>
              <col style={{ width: hasImages ? "42%" : "48%" }} />
              <col style={{ width: "15%" }} />
              <col />
              <col />
              <col style={{ width: "14%" }} />
              {hasImages && <col style={{ width: "9%" }} />}
            </colgroup>
            <thead>
              <tr>
                <th>Species</th>
                <th>Total at points</th>
                <th>Adult*</th>
                <th>Juvenile*</th>
                <th>Points seen at</th>
                {hasImages && <th>In images</th>}
              </tr>
            </thead>
            <tbody>
              {report.species.map((s, i) => (
                <tr key={s.speciesId}>
                  <td>
                    <div className="r-species">
                      <span className="r-no">{i + 1}</span>
                      <Picture s={s} />
                      <div style={{ minWidth: 0 }}>
                        <div className="r-name">{s.common}</div>
                        {s.scientific !== "—" && <div className="r-sci">{s.scientific}</div>}
                        {s.seenBetweenPoints && <div className="r-note">Seen between points only</div>}
                      </div>
                    </div>
                  </td>
                  <td>
                    {report.pointsTotal ? s.totalAtPoints : <span className="r-dash">–</span>}
                    {s.totalAtPoints > 0 && (
                      <div className="r-bar">
                        <i style={{ width: `${(s.totalAtPoints / most) * 100}%` }} />
                      </div>
                    )}
                  </td>
                  <td className="r-dash">–</td>
                  <td className="r-dash">–</td>
                  <td>
                    {report.pointsTotal ? `${s.pointsSeen} of ${report.pointsTotal}` : <span className="r-dash">–</span>}
                  </td>
                  {hasImages && <td>{s.inImages}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
