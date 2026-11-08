// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoResult } from "../src/shared/api";
import { ConfirmWindowsDialog } from "../src/renderer/src/components/ConfirmWindowsDialog";

const fake = vi.hoisted(() => ({ results: vi.fn(), confirmWindow: vi.fn() }));
vi.mock("../src/renderer/src/api", () => ({
  api: { surveys: { results: fake.results }, videos: { confirmWindow: fake.confirmWindow } },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const video = (id: number, changes: Partial<VideoResult> = {}) =>
  ({
    id,
    name: `v${id}.mp4`,
    recordedAt: "",
    transect: "T1",
    stat: "STAT 2",
    proposedStartS: 60,
    proposedEndS: 960,
    proposedReason: "Water looks settled.",
    tooShort: false,
    shortWindow: false,
    confirmedBy: "",
    ...changes,
  }) as VideoResult;

let host: HTMLDivElement;
let root: Root;
const onFinished = vi.fn();
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement;
const show = async (videos: VideoResult[]) => {
  fake.results.mockResolvedValue({ videos });
  await act(async () =>
    root.render(<ConfirmWindowsDialog surveyId={8} person={{ name: "Ana", role: "" }} onFinished={onFinished} />),
  );
};
const confirm = () =>
  act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

beforeEach(() => {
  onFinished.mockReset();
  fake.results.mockReset();
  fake.confirmWindow.mockReset();
  fake.confirmWindow.mockResolvedValue({});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("ConfirmWindowsDialog", () => {
  it("asks about each unconfirmed video in turn, then finishes", async () => {
    await show([video(1), video(2, { tooShort: true }), video(3, { confirmedBy: "Bo" }), video(4)]);
    expect(host.textContent).toContain("Video 1 of 2");
    expect(host.textContent).toContain("v1.mp4");
    await confirm();
    expect(fake.confirmWindow).toHaveBeenLastCalledWith("1", 60, 960, "Ana");
    expect(host.textContent).toContain("Video 2 of 2");
    expect(onFinished).not.toHaveBeenCalled();
    await confirm();
    expect(fake.confirmWindow).toHaveBeenLastCalledWith("4", 60, 960, "Ana");
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it("stays open and shows the reason when a time isn't allowed", async () => {
    fake.confirmWindow.mockRejectedValue(new Error("The window can't start before 1:00."));
    await show([video(1)]);
    await confirm();
    expect(host.textContent).toContain("The window can't start before 1:00.");
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("can be left with Decide later without confirming", async () => {
    await show([video(1), video(2)]);
    act(() => button("Decide later").click());
    expect(fake.confirmWindow).not.toHaveBeenCalled();
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it("isn't shown when no video is waiting", async () => {
    await show([video(1, { tooShort: true })]);
    expect(onFinished).toHaveBeenCalledOnce();
  });
});
