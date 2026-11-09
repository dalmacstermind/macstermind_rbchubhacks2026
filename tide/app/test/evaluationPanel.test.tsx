// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Evaluation, SurveyInfo } from "../src/shared/api";
import { EvaluationPanel } from "../src/renderer/src/components/EvaluationPanel";

const fake = vi.hoisted(() => ({ list: vi.fn(), evaluate: vi.fn() }));
vi.mock("../src/renderer/src/api", () => ({ api: { surveys: { list: fake.list, evaluate: fake.evaluate } } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const survey = (id: number, frameCount: number) =>
  ({ id, site: "Mahone Bay", surveyDate: "2025-08-20", frameCount }) as SurveyInfo;
const nothingMatched = {
  source: "hand.csv",
  pointsCompared: 0,
  unmatchedHuman: ["a.mp4 point 1"],
  videos: [],
} as unknown as Evaluation;

let host: HTMLDivElement;
let root: Root;
const pickCsv = vi.fn();
const show = () => act(async () => root.render(<EvaluationPanel />));
const compare = () =>
  act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "Compare with hand counts…")!.click(),
  );

beforeEach(() => {
  fake.list.mockReset();
  fake.evaluate.mockReset();
  pickCsv.mockReset();
  (window as unknown as { desktop: unknown }).desktop = { pickCsv };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Settings: Accuracy check", () => {
  it("offers only surveys with something counted", async () => {
    fake.list.mockResolvedValue([survey(9, 156), survey(7, 0)]);
    await show();
    expect([...host.querySelectorAll("option")].map((o) => o.value)).toEqual(["9"]);
  });

  it("says so when no survey has been counted", async () => {
    fake.list.mockResolvedValue([survey(7, 0)]);
    await show();
    expect(host.textContent).toContain("No counted surveys yet.");
  });

  it("compares the chosen survey with the chosen CSV", async () => {
    fake.list.mockResolvedValue([survey(9, 156)]);
    fake.evaluate.mockResolvedValue(nothingMatched);
    pickCsv.mockResolvedValue("C:/hand.csv");
    await show();
    await compare();
    expect(fake.evaluate).toHaveBeenCalledWith(9, "C:/hand.csv");
    expect(document.body.textContent).toContain("none of the hand counts match");
  });

  it("does nothing if the file picker is cancelled", async () => {
    fake.list.mockResolvedValue([survey(9, 156)]);
    pickCsv.mockResolvedValue(null);
    await show();
    await compare();
    expect(fake.evaluate).not.toHaveBeenCalled();
  });

  it("no longer offers measuring against reviewed points", async () => {
    fake.list.mockResolvedValue([survey(9, 156)]);
    await show();
    expect(host.textContent).not.toContain("reviewed points");
  });
});
