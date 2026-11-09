// The downloadable PDF report, top to bottom. Only displays what GET /surveys/{id}/report sends.
import type { SurveyInfo, SurveyReport } from "../../../shared/api";
import type { OpenItem } from "../../../shared/survey";
import { niceDate } from "../reportFormat";
import { ReportAppendix } from "./ReportAppendix";
import { ReportBanner } from "./ReportBanner";
import { ReportFindings } from "./ReportFindings";
import { ReportSpeciesTable } from "./ReportSpeciesTable";
import { ReportSurveyInfo } from "./ReportSurveyInfo";

export function ReportDocument({
  survey,
  report,
  open,
  modelName,
  createdOn,
}: {
  survey: SurveyInfo;
  report: SurveyReport;
  open: OpenItem[];
  modelName: string;
  createdOn: string; // YYYY-MM-DD
}) {
  return (
    <div className="tide-report">
      <ReportBanner site={survey.site} date={survey.surveyDate} openCount={open.length} />
      {report.isSampleData && (
        <div className="r-notice">Made in Demo mode: this survey contains sample data, not real results.</div>
      )}
      <ReportSurveyInfo survey={survey} report={report} modelName={modelName} />
      <ReportFindings report={report} />
      <ReportSpeciesTable report={report} />
      <ReportAppendix report={report} open={open} />
      <div className="r-created">Created on this computer with TIDE, {niceDate(createdOn)}. Nothing left this computer.</div>
    </div>
  );
}
