// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SurveyOverview } from "../src/renderer/src/overview";
import { QcView } from "../src/renderer/src/views/QC";

vi.mock("../src/renderer/src/api", () => ({ api: {} }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const survey = (total: number, done: number, agreement: number | null) =>
  ({
    data: { survey: { id: 1, site: "Site" } },
    qc: { total, done, agreement, target: 95 },
  }) as unknown as SurveyOverview;

let host: HTMLDivElement;
let root: Root;
const show = (item: SurveyOverview) =>
  act(() =>
    root.render(
      <QcView
        overview={[item]}
        species={[]}
        person={{ name: "Ana", role: "" }}
        surveyId={null}
        setSurveyId={() => undefined}
        onChanged={() => undefined}
      />,
    ),
  );
const buttons = () => [...host.querySelectorAll("button")].map((b) => b.textContent);

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Blind QC list", () => {
  it("says there is nothing to check when a survey has no pictures to recount", () => {
    show(survey(0, 0, null));
    expect(host.textContent).toContain("Nothing to check yet");
    expect(host.textContent).not.toContain("Below");
    expect(buttons()).not.toContain("Review");
  });

  it("still says not started when nobody has recounted yet", () => {
    show(survey(5, 0, null));
    expect(host.textContent).toContain("Not started");
    expect(buttons()).toContain("Start");
  });

  it("still reports a real result below the target", () => {
    show(survey(5, 5, 80));
    expect(host.textContent).toContain("Below 95% target");
  });

  it("still reports a real result that meets the target", () => {
    show(survey(5, 5, 100));
    expect(host.textContent).toContain("Meets target");
  });
});
