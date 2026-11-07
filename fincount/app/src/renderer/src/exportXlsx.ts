// Builds the Excel workbook for a survey: Summary, Pictures and Read me sheets.
// Exports with open items are marked "Draft" and list what's still open on the Read me sheet.
import ExcelJS from "exceljs";
import type { SurveyData } from "../../shared/api";
import {
  STATUS_LABEL,
  UNKNOWN,
  frameCounts,
  needsReview,
  type OpenItem,
  type Species,
  type Summary,
} from "../../shared/survey";

export async function buildWorkbook(opts: {
  data: SurveyData;
  summary: Summary;
  species: Species[];
  open: OpenItem[];
  person: string;
}): Promise<ArrayBuffer> {
  const { data, summary: s, species, open, person } = opts;
  const { survey, frames } = data;
  const draft = open.length > 0;
  const wb = new ExcelJS.Workbook();
  wb.creator = "FinCount";
  wb.created = new Date();
  const bold = { font: { bold: true } };

  // Summary
  const sum = wb.addWorksheet("Summary");
  sum.addRow([`${survey.site}${draft ? " — DRAFT" : ""}`]).font = { bold: true, size: 14 };
  sum.addRow(["Date filmed", survey.surveyDate || "Not recorded"]);
  sum.addRow(["Fish counted (MaxN)", s.total]);
  sum.addRow(["Invertebrates counted (MaxN)", s.invertebrates]);
  sum.addRow(["Fish species found", s.speciesCount]);
  sum.addRow([]);
  const head = sum.addRow([
    "Common name",
    "Scientific name",
    "Group",
    "Status",
    "Habitat",
    "Count (MaxN)",
    "Sightings",
    "Average certainty",
    "Corrected by staff",
  ]);
  head.eachCell((c) => Object.assign(c, bold));
  for (const r of s.rows) {
    sum.addRow([
      r.sp.common,
      r.sp.scientific,
      r.sp.kind === "invertebrate" ? "Invertebrate" : "Fish",
      r.sp.id === UNKNOWN ? "Not identified" : STATUS_LABEL[r.sp.status],
      r.sp.habitat,
      r.maxN,
      r.sightings,
      Math.round(r.conf * 100) / 100,
      r.corrected,
    ]);
  }
  sum.getColumn(8).numFmt = "0%";
  sum.columns.forEach((c, i) => (c.width = [26, 30, 13, 15, 12, 13, 11, 17, 18][i] ?? 12));

  // Pictures
  const pics = wb.addWorksheet("Pictures");
  pics
    .addRow([
      "File",
      "Time",
      "Fish",
      "Invertebrates",
      "Waiting to be checked",
      "Water clarity (estimate)",
      "Checked by",
    ])
    .eachCell((c) => Object.assign(c, bold));
  for (const f of frames) {
    const c = frameCounts(f, species, survey.threshold);
    pics.addRow([
      f.source,
      f.timestamp,
      c.fish,
      c.invertebrates,
      f.detections.filter((d) => needsReview(d, survey.threshold)).length,
      f.clarity ?? "",
      [...new Set(f.detections.map((d) => d.editedBy).filter(Boolean))].join(", "),
    ]);
  }
  pics.columns.forEach((c, i) => (c.width = [34, 10, 8, 14, 22, 24, 20][i] ?? 12));

  // Read me
  const me = wb.addWorksheet("Read me");
  const rows: (string | number)[][] = [
    ["FinCount survey export"],
    ["Status", draft ? "DRAFT — exported with open items (listed below)" : "Final — nothing left to check"],
    ["Site", survey.site],
    ["Date filmed", survey.surveyDate || "Not recorded"],
    ["Type of water", survey.environment],
    ["Footage", survey.files.join("; ")],
    ["Analysed", `${survey.createdAt}${survey.createdBy ? ` by ${survey.createdBy}` : ""}`],
    ["Checked by", s.checkedBy.join(", ") || "Nobody yet (AI only)"],
    ["Exported", `${new Date().toLocaleString()}${person ? ` by ${person}` : ""}`],
    [
      "Counted automatically at",
      `${Math.round(survey.threshold * 100)}% certainty or higher; less certain finds only count once a person confirms them`,
    ],
    [
      "How fish are counted",
      "MaxN: the most individuals of each species seen in a single picture, so a fish isn't counted again in every picture it appears in. Invertebrates are counted separately.",
    ],
  ];
  if (draft) rows.push([], ["Open items"], ...open.map((o) => ["", o.text]));
  rows.forEach((r) => me.addRow(r));
  me.getRow(1).font = { bold: true, size: 14 };
  me.getColumn(1).width = 26;
  me.getColumn(2).width = 100;
  me.getColumn(2).alignment = { wrapText: true, vertical: "top" };

  if (draft)
    wb.views = [{ activeTab: 2, x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, visibility: "visible" }];
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
