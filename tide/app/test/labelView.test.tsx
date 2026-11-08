// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SurveyData } from "../src/shared/api";
import type { Species } from "../src/shared/survey";
import { LabelView } from "../src/renderer/src/views/Label";

const fake = vi.hoisted(() => ({ unknowns: vi.fn(), add: vi.fn() }));
vi.mock("../src/renderer/src/api", () => ({
  api: { surveys: { unknowns: fake.unknowns }, labels: { add: fake.add } },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fish = {
  trackId: "t1",
  crop: "crop.jpg",
  source: { kind: "video", file: "a.mp4", videoId: 1, pointNo: 1, timestamp: "00:01:00", role: "point" },
  frameIds: ["f1"],
  bestFrameId: "f1",
  box: { x: 1, y: 1, w: 1, h: 1 },
  aiLabel: "Unknown",
  suggestions: [{ speciesId: "cod", score: 0.6 }],
  reason: "Low confidence",
  label: null,
};
const data = {
  survey: { id: 8, site: "Site" },
  frames: [{ id: "f1", image: "p.jpg", source: "a.mp4", timestamp: "00:01:00", detections: [] }],
} as unknown as SurveyData;
const species = [
  { id: "cod", common: "Cod", scientific: "", status: "native", habitat: "", kind: "fish" },
] as Species[];

let host: HTMLDivElement;
let root: Root;
const show = () =>
  act(async () =>
    root.render(
      <LabelView
        data={data}
        species={species}
        setSpecies={() => undefined}
        person={{ name: "Ana", role: "" }}
        onChanged={() => undefined}
      />,
    ),
  );
const tick = () => act(() => host.querySelector<HTMLInputElement>('input[aria-label^="Select fish"]')!.click());
const referenceBox = () =>
  [...host.querySelectorAll("label")]
    .find((l) => l.textContent?.startsWith("Use as reference"))!
    .querySelector("input") as HTMLInputElement;

beforeEach(() => {
  fake.unknowns.mockReset();
  fake.add.mockReset();
  fake.unknowns.mockResolvedValue({ fish: [fish], remaining: 1, remainingByFile: { "a.mp4": 1 } });
  fake.add.mockResolvedValue({ remaining: 0 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Label unknown fish", () => {
  it("unticks 'Use as reference picture' after each label", async () => {
    await show();
    act(() => host.querySelector<HTMLElement>('img[alt="Fish to label"]')!.closest("button")!.click());
    act(() => referenceBox().click());
    expect(referenceBox().checked).toBe(true);
    const suggestion = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Cod"))!;
    await act(async () => suggestion.click());
    expect(fake.add.mock.calls[0]![0].useAsReference).toBe(true);
    expect(referenceBox().checked).toBe(false);
  });

  it("keeps 'Use as reference picture' ticked if the label couldn't be saved", async () => {
    fake.add.mockRejectedValue(new Error("Couldn't save."));
    await show();
    act(() => host.querySelector<HTMLElement>('img[alt="Fish to label"]')!.closest("button")!.click());
    act(() => referenceBox().click());
    const suggestion = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Cod"))!;
    await act(async () => suggestion.click());
    expect(referenceBox().checked).toBe(true);
  });

  it.each([
    ["status", 0, "all"],
    ["file", 1, "a.mp4"],
  ])("clears the ticked fish when the %s filter changes", async (_name, index, value) => {
    await show();
    tick();
    expect(host.textContent).toContain("Label 1 selected fish");
    const select = host.querySelectorAll("select")[index]!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.textContent).not.toContain("selected fish");
    expect(host.textContent).toContain("Choose a fish");
  });
});
