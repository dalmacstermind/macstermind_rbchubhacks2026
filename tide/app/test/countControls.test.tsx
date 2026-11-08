// @vitest-environment jsdom
// Stopping a count and counting again (the analysis window box on the report), in a simulated browser
// page (jsdom, a test-only tool). The back end is replaced by a small fake (vi.mock).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoResult } from "../src/shared/api";
import { CountControls } from "../src/renderer/src/components/CountControls";

// Tells React these updates happen inside tests (so act() waits for them).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fake = vi.hoisted(() => ({ startCount: vi.fn(async () => {}), stopCount: vi.fn(async () => {}) }));
vi.mock("../src/renderer/src/api", () => ({ api: { videos: fake } }));

const video = (over: Partial<VideoResult>) =>
  ({ id: 7, name: "GX010021.MP4", countState: "", countDetail: "", ...over }) as VideoResult;
const PERSON = { name: "Ana", role: "Counter" };

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  fake.startCount.mockClear();
  fake.stopCount.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const show = (v: VideoResult, onChanged = vi.fn()) => {
  act(() => root.render(<CountControls video={v} person={PERSON} onChanged={onChanged} />));
  return onChanged;
};
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement | undefined;

describe("CountControls", () => {
  it("stops a running count after asking first", async () => {
    const onChanged = show(video({ countState: "running", countDetail: "Counting the points: 5%" }));
    expect(host.textContent).not.toContain("Counting the points: 5%"); // CountProgress shows it, not a second chip
    act(() => button("Stop counting")!.click());
    expect(document.body.textContent).toContain("Nothing of this count is kept");
    expect(fake.stopCount).not.toHaveBeenCalled(); // nothing happens until the person says yes
    const dialog = document.querySelector('[role="dialog"]')!;
    const yes = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Stop counting")!;
    await act(async () => yes.click());
    expect(fake.stopCount).toHaveBeenCalledWith(7, "Ana");
    expect(onChanged).toHaveBeenCalled();
  });

  it("offers Count again after counting stopped or was interrupted", async () => {
    show(video({ countState: "stopped", countDetail: "Counting was interrupted because TIDE closed." }));
    expect(host.textContent).toContain("interrupted because TIDE closed");
    expect(button("Stop counting")).toBeUndefined();
    await act(async () => button("Count again")!.click());
    expect(fake.startCount).toHaveBeenCalledWith(7, "Ana");
  });

  it("shows neither button once counting is done", () => {
    show(video({ countState: "done", countDetail: "3 points" }));
    expect(button("Stop counting")).toBeUndefined();
    expect(button("Count again")).toBeUndefined();
  });
});
