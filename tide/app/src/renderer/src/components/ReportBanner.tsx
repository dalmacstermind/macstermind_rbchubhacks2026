// The top of the PDF report: title, site, draft state, and the TIDE and Coastal Action logos on the ocean gradient.
import coastalActionSeal from "../assets/coastal-action-seal.png";
import { niceDate } from "../reportFormat";

export function ReportBanner({
  site,
  date,
  openCount,
}: {
  site: string;
  date: string;
  openCount: number;
}) {
  return (
    <header className="r-banner">
      <div>
        <div className="r-eyebrow">Fish and fish habitat survey</div>
        <h1>Report</h1>
        <div className="r-site">
          {site} · {niceDate(date)}
        </div>
        <span className="r-pill">
          {openCount ? `Draft: ${openCount} ${openCount === 1 ? "item" : "items"} open` : "No open items"}
        </span>
      </div>
      <div className="r-logo">
        <div>
          <div className="r-logo-row">
            <div className="r-tile">T</div>
            <div className="r-word">TIDE</div>
          </div>
          <div className="r-tag">
            Tracking &amp; Identification
            <br />
            for Deep-sea Ecosystems
          </div>
        </div>
        <div className="r-logo-rule" aria-hidden />
        <img className="r-seal" src={coastalActionSeal} alt="Coastal Action" />
      </div>
      <svg className="r-wave" viewBox="0 0 720 26" preserveAspectRatio="none" aria-hidden>
        <path d="M0 14 C 90 0 180 26 300 13 C 420 0 540 24 720 8 L720 26 L0 26 Z" fill="white" opacity="0.14" />
        <path d="M0 20 C 120 8 220 28 360 18 C 500 8 610 26 720 16 L720 26 L0 26 Z" fill="white" opacity="0.18" />
      </svg>
    </header>
  );
}
