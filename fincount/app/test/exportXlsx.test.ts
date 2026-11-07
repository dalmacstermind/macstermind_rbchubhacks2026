import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { SurveyData, Video } from "../src/shared/api";
import { DEFAULT_SPECIES, summarize } from "../src/shared/survey";
import { buildWorkbook, mmss, videoRows, windowOpenItems, VIDEO_COLUMNS } from "../src/renderer/src/exportXlsx";

const video = (over: Partial<Video>): Video => ({
  id: "1",
  surveyId: 1,
  fileName: "GX010021.MP4",
  durationS: 1212,
  fps: 30,
  proposedStartS: 60,
  proposedEndS: 960,
  proposedReason: "Water looks settled at 01:00.0.",
  settled: true,
  tooShort: false,
  settleScore: 0.2,
  windowStartS: null,
  windowEndS: null,
  confirmedBy: "",
  confirmedAt: "",
  ...over,
});

const confirmed = video({ windowStartS: 125, windowEndS: 1025, confirmedBy: "Alex", confirmedAt: "2026-11-07 10:00:00" });
const unconfirmed = video({ id: "2", fileName: "GX010022.MP4" });
const tooShort = video({
  id: "3",
  fileName: "GX010023.MP4",
  durationS: 180,
  proposedStartS: null,
  proposedEndS: null,
  proposedReason: "Too short for the protocol",
  settled: null,
  tooShort: true,
});

describe("Videos sheet", () => {
  it("formats times as minutes:seconds", () => {
    expect(mmss(60)).toBe("01:00.0");
    expect(mmss(1025.5)).toBe("17:05.5");
    expect(mmss(null)).toBe("");
  });

  it("fills the window only when a person confirmed it", () => {
    const rows = videoRows([confirmed, unconfirmed, tooShort]);
    const [a, b, c] = [rows[0]!, rows[1]!, rows[2]!];
    expect(a).toEqual([
      "GX010021.MP4",
      "20:12.0",
      "01:00.0 – 16:00.0",
      "Water looks settled at 01:00.0.",
      125,
      1025,
      "02:05.0 – 17:05.0",
      "Alex",
      "2026-11-07 10:00:00",
      "Confirmed",
    ]);
    expect(b.slice(4, 8)).toEqual(["", "", "", ""]);
    expect(b[9]).toBe("Window not confirmed");
    expect(c[2]).toBe("—");
    expect(c[9]).toContain("Too short");
  });

  it("notes a confirmed window that started while sediment looked unsettled", () => {
    expect(videoRows([{ ...confirmed, settled: false }])[0]![9]).toContain("unsettled");
  });

  it("lists unconfirmed and too-short videos as open items", () => {
    expect(windowOpenItems([confirmed])).toEqual([]);
    expect(windowOpenItems([confirmed, unconfirmed, tooShort])).toEqual([
      "Analysis window not confirmed on 1 video",
      "1 video too short for the protocol (flagged, not processed)",
    ]);
  });

  it("writes the Videos sheet and marks the export as a draft while windows are open", async () => {
    const data: SurveyData = {
      survey: {
        id: 1,
        site: "Mahone Bay",
        environment: "Coastal marine",
        threshold: 0.5,
        createdAt: "2026-11-07",
        surveyDate: "2025-08-20",
        createdBy: "Alex",
        files: ["GX010021.MP4", "GX010022.MP4"],
        frameCount: 0,
        status: "done",
      },
      frames: [],
    };
    const buf = await buildWorkbook({
      data,
      summary: summarize([], DEFAULT_SPECIES, 0.5),
      species: DEFAULT_SPECIES,
      open: [],
      videos: [confirmed, unconfirmed],
      person: "Alex",
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const sheet = wb.getWorksheet("Videos")!;
    expect(sheet.getRow(1).values).toEqual([undefined, ...VIDEO_COLUMNS]);
    expect(sheet.getRow(2).getCell(5).value).toBe(125);
    expect(sheet.getRow(2).getCell(8).value).toBe("Alex");
    const readMe = wb.getWorksheet("Read me")!;
    const text = readMe.getSheetValues().flat().join(" ");
    expect(text).toContain("DRAFT");
    expect(text).toContain("Analysis window not confirmed on 1 video");
  });
});
