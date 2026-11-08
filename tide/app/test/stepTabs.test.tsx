// Draws the step tabs to HTML (with React's own server renderer, so no extra test library is
// needed) and checks the order, which tab is current, and the badge.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StepTabs } from "../src/renderer/src/components/StepTabs";
import type { Page } from "../src/renderer/src/pages";

// "Start a new survey" is not a step: it's the button at the top of the Tools column.
const ORDER = ["Counting", "Report", "Check the fish", "Label unknown fish"];

function render(page: Page, opts: { busy?: boolean; hasSurvey?: boolean; toCheck?: number } = {}) {
  const html = renderToStaticMarkup(
    <StepTabs
      page={page}
      go={() => {}}
      busy={opts.busy ?? false}
      hasSurvey={opts.hasSurvey ?? true}
      toCheck={opts.toCheck ?? 0}
    />,
  );
  // One entry per tab button: its attributes and its visible text (without the step number).
  const buttons = [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, attrs, inner]) => ({
    attrs: attrs!,
    text: inner!
      .replace(/<span aria-hidden="true"[^>]*>\d<\/span>/, "")
      .replace(/<[^>]+>/g, "")
      .trim(),
  }));
  return { html, buttons };
}

describe("step tabs", () => {
  it("shows the four tabs in order", () => {
    const { buttons } = render("report");
    expect(buttons.map((b) => b.text)).toEqual(ORDER);
  });

  it("marks only the current tab with aria-current=page", () => {
    for (const [page, label] of [
      ["report", "Report"],
      ["review", "Check the fish"],
      ["label", "Label unknown fish"],
    ] as const) {
      const current = render(page).buttons.filter((b) => b.attrs.includes('aria-current="page"'));
      expect(current.map((b) => b.text)).toEqual([label]);
    }
  });

  it("no tab is current on a tools page (e.g. Settings) or the Start a new survey page", () => {
    expect(render("settings").html).not.toContain("aria-current");
    expect(render("upload").html).not.toContain("aria-current");
  });

  it("is a labelled navigation landmark", () => {
    expect(render("upload").html).toContain('<nav aria-label="Survey steps"');
  });

  it("keeps the badge on Check the fish", () => {
    const { buttons } = render("report", { toCheck: 3 });
    expect(buttons.find((b) => b.text.startsWith("Check the fish"))!.text).toBe("Check the fish3");
    expect(render("report", { toCheck: 0 }).buttons[2]!.text).toBe("Check the fish");
  });

  it("locks the steps that can't be used yet", () => {
    const enabled = (page: Page, opts: Parameters<typeof render>[1]) =>
      render(page, opts)
        .buttons.filter((b) => !b.attrs.includes('disabled=""')) // the attribute, not the "disabled:" CSS class
        .map((b) => b.text);
    // A fresh start (no survey open): every step is greyed out.
    expect(enabled("upload", { hasSurvey: false })).toEqual([]);
    expect(enabled("report", { hasSurvey: true })).toEqual([
      "Report",
      "Check the fish",
      "Label unknown fish",
    ]);
    expect(enabled("processing", { busy: true, hasSurvey: true })).toEqual([]);
  });
});
