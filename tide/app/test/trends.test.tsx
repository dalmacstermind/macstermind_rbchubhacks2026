// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotPlottedVideo, Trends } from "../src/shared/api";
import { TrendsView } from "../src/renderer/src/views/Trends";

const fake = vi.hoisted(() => ({ get: vi.fn(), details: vi.fn() }));
vi.mock("../src/renderer/src/api", () => ({
  api: { trends: { get: fake.get }, videos: { details: fake.details } },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const video = (reason: string, explanation: string): NotPlottedVideo => ({
  videoId: 7,
  surveyId: 8,
  surveySite: "Untitled survey",
  fileName: "clip.mp4",
  transect: "T1",
  stat: "STAT 2",
  recordedAt: "",
  reason,
  explanation,
});
const trends = (notPlotted: NotPlottedVideo[]): Trends => ({
  points: [],
  groups: [],
  notPlotted,
  transects: ["T1"],
  stats: ["STAT 2"],
});

let host: HTMLDivElement;
let root: Root;
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement | undefined;
const show = async () => {
  await act(async () => root.render(<TrendsView theme="light" onOpen={() => undefined} />));
};

beforeEach(() => {
  fake.get.mockReset();
  fake.details.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Trends", () => {
  it("offers AI-only results when every counted video is unreviewed", async () => {
    fake.get.mockResolvedValue(trends([video("not_reviewed", "Counted, but not reviewed yet")]));
    await show();
    expect(fake.get.mock.calls[0]![0].reviewedOnly).toBe(true);
    expect(host.textContent).toContain("1 video counted but not reviewed yet");
    await act(async () => button("Include AI-only results")!.click());
    expect(fake.get.mock.lastCall![0].reviewedOnly).toBe(false);
  });

  it("lists a video with no date and saves the date a person enters", async () => {
    fake.get.mockResolvedValue(trends([video("no_date", "No recording date")]));
    fake.details.mockResolvedValue(undefined);
    await show();
    expect(host.textContent).toContain("Survey 8: Untitled survey");
    act(() => button("Add date")!.click());
    expect(button("Save")!.disabled).toBe(true);
    const input = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="date"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "2025-08-20");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Save")!.click());
    expect(fake.details).toHaveBeenCalledWith(7, { recordedAt: "2025-08-20" });
    expect(fake.get).toHaveBeenCalledTimes(2); // loaded again, so the video moves onto the graphs
  });
});
