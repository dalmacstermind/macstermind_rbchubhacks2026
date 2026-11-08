// Draws the Tools column to HTML (React's own server renderer, no extra test library) and checks
// the heading, the order of the tools, and which one is current.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolsSidebar } from "../src/renderer/src/components/ToolsSidebar";
import type { Page } from "../src/renderer/src/pages";

function render(page: Page, busy = false) {
  const html = renderToStaticMarkup(<ToolsSidebar page={page} go={() => {}} onNewSurvey={() => {}} busy={busy} />);
  const buttons = [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, attrs, inner]) => ({
    attrs: attrs!,
    text: inner!
      .replace(/<span aria-hidden="true"[^>]*>.*?<\/span>/, "") // the icon
      .replace(/<[^>]+>/g, "")
      .trim(),
  }));
  return { html, buttons };
}

describe("tools column", () => {
  it("shows Start a new survey above the Tools heading, then the five tools in order", () => {
    const { html, buttons } = render("settings");
    expect(html).toContain('<nav aria-label="Tools"');
    expect(html.indexOf("Start a new survey")).toBeLessThan(html.indexOf(">Tools<"));
    expect(buttons.map((b) => b.text)).toEqual([
      "Start a new survey",
      "Surveys",
      "Blind QC",
      "Trends",
      "Species Registry",
      "Settings",
    ]);
  });

  it("marks Start a new survey as current on the Start page", () => {
    const current = render("upload").buttons.filter((b) => b.attrs.includes('aria-current="page"'));
    expect(current.map((b) => b.text)).toEqual(["Start a new survey"]);
  });

  it("marks only the current tool with aria-current=page", () => {
    const current = render("trends").buttons.filter((b) => b.attrs.includes('aria-current="page"'));
    expect(current.map((b) => b.text)).toEqual(["Trends"]);
    expect(render("report").html).not.toContain("aria-current"); // a survey step is open, not a tool
  });

  it("locks the tools while a survey is being counted", () => {
    expect(render("processing", true).buttons.every((b) => b.attrs.includes('disabled=""'))).toBe(true);
    expect(render("upload", false).buttons.some((b) => b.attrs.includes('disabled=""'))).toBe(false);
  });
});
