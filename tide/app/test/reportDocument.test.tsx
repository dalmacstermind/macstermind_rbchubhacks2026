// The downloadable report shows what the agreed layout says, and never passes off sample data as real.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SurveyInfo, SurveyReport } from "../src/shared/api";
import { ReportDocument } from "../src/renderer/src/components/ReportDocument";
import { fileSize, fileTypes, niceDate } from "../src/renderer/src/reportFormat";
import { PROTOCOL_DEFAULTS } from "./fixtures";

const survey = {
  id: 42,
  site: "Mahone Bay",
  surveyDate: "2025-08-20",
  createdBy: "Sam",
  protocol: PROTOCOL_DEFAULTS,
} as SurveyInfo;

const report = {
  results: { videos: [], images: [], unknownsRemaining: 0, visibilityCategories: [] },
  files: [{ name: "a.jpg", sizeBytes: 2000000 }],
  isSampleData: false,
  identifiedSpecies: 1,
  aiOnly: 1,
  humanApproved: 0,
  nativeNoted: 0,
  invasiveNoted: 0,
  unusualNoted: 0,
  statusNotNoted: 1,
  unidentifiedFish: 2,
  invertebrates: 0,
  pointsTotal: 15,
  species: [
    {
      speciesId: "cod",
      common: "Atlantic cod",
      scientific: "Gadus morhua",
      totalAtPoints: 0,
      pointsSeen: 0,
      inImages: 0,
      seenBetweenPoints: true,
      humanApproved: false,
      picture: null,
      referencePicture: null,
    },
  ],
} as SurveyReport;

const render = (r: SurveyReport, open = 0) =>
  renderToStaticMarkup(
    <ReportDocument
      survey={survey}
      report={r}
      open={Array.from({ length: open }, () => ({ key: "review" as const, text: "To check" }))}
      modelName="Test model"
      createdOn="2026-11-08"
    />,
  );

describe("downloadable report", () => {
  it("uses the agreed wording and keeps adult and juvenile empty", () => {
    const html = render(report);
    for (const text of ["Number of identified species", "Native (noted by staff)", "Invasive (noted by staff)", "Status not noted", "Unidentified fish", "Total at points", "Seen between points only", "No open items", "Adult*", "Juvenile*", "TIDE"])
      expect(html).toContain(text);
    expect(html).not.toContain("Local");
    expect(html).not.toContain("Reviewed by");
    expect(html).toContain('alt="Coastal Action"');
  });

  it("names videos Video 1, Video 2 on MeanCount", () => {
    const video = { id: 1, name: "a.mp4", transect: "", stat: "", windowStartS: 60, windowEndS: 960, confirmedBy: "", meanCount: 1.5, meanCountAi: 1.5, visibility: null, visibilityConfirmed: false, clarityIndex: null };
    const videos = [video, { ...video, id: 2, name: "b.mp4" }] as SurveyReport["results"]["videos"];
    const html = render({ ...report, results: { ...report.results, videos } });
    expect(html).toContain("Video 1");
    expect(html).toContain("Video 2");
  });

  it("shows draft state and open items", () => {
    const html = render(report, 2);
    expect(html).toContain("Draft: 2 items open");
    expect(html).toContain("To check");
  });

  it("says so when a survey holds sample data", () => {
    expect(render({ ...report, isSampleData: true })).toContain("sample data, not real results");
    expect(render(report)).not.toContain("sample data, not real results");
  });

  it("formats display values", () => {
    expect(fileSize(8100000000)).toBe("8.1 GB");
    expect(niceDate("2025-08-20")).toBe("20 Aug 2025");
    expect(fileTypes(["a.mp4", "b.JPG", "c.MP4"])).toBe("JPG, MP4");
  });
});
