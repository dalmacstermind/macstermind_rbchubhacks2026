// Builds the Excel workbook for a survey: Points (protocol, per video), Images, Summary, Pictures, Videos
// and Read me. The Points and Images rows come straight from GET /surveys/{id}/results: no counting here.
// Exports with open items are marked "Draft" and list what's still open on the Read me sheet.
import ExcelJS from "exceljs";
import type { SurveyData, SurveyResults, Video } from "../../shared/api";
import {
  STATUS_LABEL,
  UNKNOWN,
  frameCounts,
  needsReview,
  type OpenItem,
  type Species,
  type Summary,
} from "../../shared/survey";

/** 75.5 -> "01:15.5". Times in the export use minutes:seconds, like the video player. */
export function mmss(seconds: number | null): string {
  if (seconds === null) return "";
  const m = Math.floor(seconds / 60);
  return `${String(m).padStart(2, "0")}:${(seconds - m * 60).toFixed(1).padStart(4, "0")}`;
}

export const VIDEO_COLUMNS = [
  "Video",
  "Length",
  "Proposed window",
  "Why this window",
  "Window start (s)",
  "Window end (s)",
  "Window",
  "Confirmed by",
  "Confirmed at",
  "Status",
];

/** One row per video for the Videos sheet. Only a window a person confirmed fills the window columns. */
export function videoRows(videos: Video[]): (string | number)[][] {
  return videos.map((v) => {
    const confirmed = v.windowStartS !== null && v.windowEndS !== null;
    const status = v.tooShort
      ? "Too short for the protocol (flagged, not processed)"
      : !confirmed
        ? "Window not confirmed"
        : v.shortWindow
          ? "Confirmed (shorter than the protocol window: not comparable with full windows)"
          : v.settled === false
            ? "Confirmed (sediment looked unsettled at the proposed start)"
            : "Confirmed";
    return [
      v.fileName,
      mmss(v.durationS),
      v.proposedStartS === null ? "—" : `${mmss(v.proposedStartS)} – ${mmss(v.proposedEndS)}`,
      v.proposedReason,
      confirmed ? v.windowStartS! : "",
      confirmed ? v.windowEndS! : "",
      confirmed ? `${mmss(v.windowStartS)} – ${mmss(v.windowEndS)}` : "",
      v.confirmedBy,
      v.confirmedAt,
      status,
    ];
  });
}

/** Window problems that make the export a draft (listed on the Read me sheet). */
export function windowOpenItems(videos: Video[]): string[] {
  const s = (n: number) => (n === 1 ? "" : "s");
  const unconfirmed = videos.filter((v) => !v.tooShort && v.windowStartS === null).length;
  const tooShort = videos.filter((v) => v.tooShort).length;
  const items: string[] = [];
  if (unconfirmed) items.push(`Analysis window not confirmed on ${unconfirmed} video${s(unconfirmed)}`);
  if (tooShort) items.push(`${tooShort} video${s(tooShort)} too short for the protocol (flagged, not processed)`);
  return items;
}

export async function buildWorkbook(opts: {
  data: SurveyData;
  summary: Summary;
  species: Species[];
  open: OpenItem[];
  videos: Video[];
  person: string;
  results?: SurveyResults | null; // protocol results from the back end
}): Promise<ArrayBuffer> {
  const { data, summary: s, species, open, videos, person, results } = opts;
  const { survey, frames } = data;
  const openTexts = [...open.map((o) => o.text), ...windowOpenItems(videos)];
  const draft = openTexts.length > 0;
  const wb = new ExcelJS.Workbook();
  wb.creator = "TIDE";
  wb.created = new Date();
  const bold = { font: { bold: true } };

  if (results?.videos.length) addPointsSheet(wb, results, species);
  if (results?.images.length) addImagesSheet(wb, results, species);

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

  // Videos: analysis window per video (proposed by TIDE, confirmed by a person)
  const vids = wb.addWorksheet("Videos");
  vids.addRow(VIDEO_COLUMNS).eachCell((c) => Object.assign(c, bold));
  videoRows(videos).forEach((r) => vids.addRow(r));
  vids.columns.forEach((c, i) => (c.width = [30, 10, 20, 60, 16, 15, 20, 16, 20, 34][i] ?? 12));
  vids.getColumn(4).alignment = { wrapText: true, vertical: "top" };

  // Read me
  const me = wb.addWorksheet("Read me");
  const rows: (string | number)[][] = [
    ["TIDE survey export"],
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
      "Points sheet (protocol): organisms seen within the tolerance window of each subsample point, each tracked fish counted once; MeanCount = sum of point counts ÷ number of points. Summary sheet: MaxN, the most of each species in one picture (an optional extra). Invertebrates are counted separately.",
    ],
    ["Clarity index", "An image-based estimate of how clear the water looks (0–100). Not turbidity. Visibility is only filled in where staff confirmed it."],
  ];
  if (results && results.unknownsRemaining > 0)
    rows.push(["Unknown fish", `${results.unknownsRemaining} fish are still labelled Unknown (see the Label page)`]);
  if (draft) rows.push([], ["Open items"], ...openTexts.map((t) => ["", t]));
  rows.forEach((r) => me.addRow(r));
  me.getRow(1).font = { bold: true, size: 14 };
  me.getColumn(1).width = 26;
  me.getColumn(2).width = 100;
  me.getColumn(2).alignment = { wrapText: true, vertical: "top" };

  if (draft)
    wb.views = [{ activeTab: wb.worksheets.length - 1, x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, visibility: "visible" }];
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Points: one row per subsample point (Coastal Action template columns first, then clarity columns). */
function addPointsSheet(wb: ExcelJS.Workbook, r: SurveyResults, species: Species[]) {
  const named = [...new Set(r.videos.flatMap((v) => v.points.flatMap((p) => Object.keys(p.perSpecies))))];
  const name = (id: string) => species.find((sp) => sp.id === id)?.common ?? id;
  const ws = wb.addWorksheet("Points");
  ws.addRow([
    "Video",
    "Transect",
    "STAT",
    "Date",
    "Point",
    "Time (s)",
    "Total fish",
    "Invertebrates",
    ...named.map(name),
    "Unknown/Unable to ID due to visibility",
    "Species observed",
    "Visibility",
    "Notes",
    "Reviewed by",
    "AI total fish",
    "Clarity index (estimate)",
    "Suggested visibility",
  ]).font = { bold: true };
  for (const v of r.videos) {
    for (const p of v.points)
      ws.addRow([
        v.name,
        v.transect,
        v.stat,
        v.recordedAt,
        p.pointNo,
        p.timestampS,
        p.totalFish,
        p.invertebrates,
        ...named.map((id) => p.perSpecies[id] ?? 0),
        p.unknown,
        p.speciesObserved,
        p.visibility ?? "",
        [p.notes, p.staffNotes].filter(Boolean).join("; "),
        p.editedBy,
        p.ai.totalFish,
        p.clarityIndex ?? "",
        p.suggestedVisibility ?? "",
      ]);
    ws.addRow([v.name, "", "", "", "MeanCount", "", v.meanCount ?? "", "", ...named.map(() => ""), "", v.speciesRichness, "", "Species richness in the Species observed column"]).font = { italic: true };
  }
  ws.columns.forEach((c, i) => (c.width = i === 0 ? 34 : 14));
}

/** Images: per-image counts (never part of MeanCount). */
function addImagesSheet(wb: ExcelJS.Workbook, r: SurveyResults, species: Species[]) {
  const named = [...new Set(r.images.flatMap((im) => Object.keys(im.perSpecies)))];
  const ws = wb.addWorksheet("Images");
  ws.addRow([
    "Image",
    "Total fish",
    "Invertebrates",
    ...named.map((id) => species.find((sp) => sp.id === id)?.common ?? id),
    "Unknown/Unable to ID due to visibility",
    "Notes",
  ]).font = { bold: true };
  for (const im of r.images)
    ws.addRow([im.relPath, im.totalFish, im.invertebrates, ...named.map((id) => im.perSpecies[id] ?? 0), im.unknown, im.notes]);
  ws.columns.forEach((c, i) => (c.width = i === 0 ? 40 : 14));
}
