// Puts the PDF report's page into the document (hidden on screen; see report.css) and says when it is
// ready to print, so that fonts and fish pictures are in the PDF.
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { SurveyInfo, SurveyReport } from "../../../shared/api";
import type { OpenItem } from "../../../shared/survey";
import { today } from "../ui";
import "../report.css";
import { ReportDocument } from "./ReportDocument";

export type ReportPrintData = { report: SurveyReport; modelName: string };

const MAX_WAIT_MS = 8000; // a picture that won't load must never block the export

export function ReportPrint({
  survey,
  open,
  data,
  onReady,
}: {
  survey: SurveyInfo;
  open: OpenItem[];
  data: ReportPrintData;
  onReady: () => void;
}) {
  // Runs once when the page appears: wait for the fonts, then for every picture (a picture that
  // fails is swapped for the next choice, so keep checking until all of them have finished).
  useEffect(() => {
    let stopped = false;
    const start = Date.now();
    const check = () => {
      if (stopped) return;
      const pictures = Array.from(document.querySelectorAll<HTMLImageElement>(".tide-report img"));
      if (pictures.every((p) => p.complete) || Date.now() - start > MAX_WAIT_MS) onReady();
      else setTimeout(check, 60);
    };
    void document.fonts.ready.then(() => setTimeout(check, 120));
    return () => {
      stopped = true;
    };
  }, []);

  return createPortal(
    <ReportDocument survey={survey} report={data.report} open={open} modelName={data.modelName} createdOn={today()} />,
    document.body,
  );
}
