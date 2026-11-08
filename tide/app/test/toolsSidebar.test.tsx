// Draws the Tools column to HTML (React's own server renderer, no extra test library) and checks
// the heading, the order of the tools, and which one is current.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolsSidebar } from "../src/renderer/src/components/ToolsSidebar";
import type { Page } from "../src/renderer/src/pages";

function render(page: Page, busy = false) {
  const html = renderToStaticMarkup(<ToolsSidebar page={page} go={() => {}} busy={busy} />);
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
  it("shows the Tools heading and the four tools in order", () => {
    const { html, buttons } = render("upload");
    expect(html).toContain('<nav aria-label="Tools"');
    expect(html).toContain(">Tools<");
    expect(buttons.map((b) => b.text)).toEqual(["Blind QC", "Trends", "Species Registry", "Settings"]);
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
