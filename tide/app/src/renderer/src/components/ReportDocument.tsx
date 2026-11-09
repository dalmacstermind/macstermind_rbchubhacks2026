// The downloadable PDF report, top to bottom. Only displays what GET /surveys/{id}/report sends.
// The "Created on this computer…" line is in the page footer (REPORT_FOOTER in src/main/index.ts).
import type { SurveyInfo, SurveyReport } from "../../../shared/api";
import type { OpenItem } from "../../../shared/survey";
import { ReportAppendix } from "./ReportAppendix";
import { ReportBanner } from "./ReportBanner";
import { ReportFindings } from "./ReportFindings";
import { ReportSpeciesTable } from "./ReportSpeciesTable";
import { ReportSurveyInfo } from "./ReportSurveyInfo";

export function ReportDocument({
  survey,
  report,
  open,
}: {
  survey: SurveyInfo;
  report: SurveyReport;
  open: OpenItem[];
}) {
  return (
    <div className="tide-report">
      <ReportBanner site={survey.site} date={survey.surveyDate} openCount={open.length} />
      {report.isSampleData && (
        <div className="r-notice">Made in Demo mode: this survey contains sample data, not real results.</div>
      )}
      <ReportSurveyInfo survey={survey} report={report} />
      <ReportFindings report={report} />
      <ReportSpeciesTable report={report} />
      <ReportAppendix report={report} open={open} />
    </div>
  );
}
