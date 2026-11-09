// @vitest-environment jsdom
import { act, createRef, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProtocolSettings } from "../src/shared/api";
import { SettingsView, type LeaveGuard } from "../src/renderer/src/views/Settings";

const fake = vi.hoisted(() => ({ get: vi.fn(), check: vi.fn(), save: vi.fn(), reset: vi.fn() }));
vi.mock("../src/renderer/src/api", () => ({
  api: {
    storage: () => Promise.resolve(null),
    surveys: { list: () => Promise.resolve([]) },
    people: { list: () => Promise.resolve([]), remove: vi.fn() },
    settings: { protocol: fake },
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const values = {
  trimStartS: 60,
  trimEndS: 60,
  maxExtraSettleS: 240,
  lengthS: 900,
  intervalS: 60,
  firstPointOffsetS: 0,
  contextS: 5,
  toleranceS: 0.5,
  maxToleranceS: 1,
  qcSamplePct: 10,
  qcMaxDiffPct: 6,
  qcAgreementPct: 95,
  pointsPerWindow: 15,
} as ProtocolSettings;

let host: HTMLDivElement;
let root: Root;
let guard: MutableRefObject<LeaveGuard | null>;
const leave = vi.fn();

// The popup's buttons sit together, next to "Keep editing".
const popupButton = (text: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent === text && b.parentElement!.textContent!.includes("Keep editing"),
  ) as HTMLButtonElement;
const click = (b: HTMLElement) => act(async () => b.click());
const typeInFirstField = (value: string) =>
  act(async () => {
    const input = document.querySelector<HTMLInputElement>('input[type="number"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const tryToLeave = () => act(async () => (guard.current ? guard.current(leave) : leave()));

beforeEach(async () => {
  leave.mockReset();
  fake.get.mockResolvedValue({ values, defaults: values, source: "default", changedBy: "", changedAt: "", warning: "" });
  fake.check.mockResolvedValue({ pointsPerWindow: 15, errors: {} });
  fake.save.mockReset();
  fake.save.mockResolvedValue({ values: { ...values, trimStartS: 90 }, defaults: values, source: "custom" });
  guard = createRef() as MutableRefObject<LeaveGuard | null>;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<SettingsView person={{ name: "Ana", role: "" }} leaveGuard={guard} />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("leaving Settings", () => {
  it("leaves straight away when nothing changed", async () => {
    await tryToLeave();
    expect(leave).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain("Save your changes?");
  });

  it("asks first, then saves and leaves", async () => {
    await typeInFirstField("90");
    await tryToLeave();
    expect(leave).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Save your changes?");
    await click(popupButton("Save"));
    expect(fake.save).toHaveBeenCalledWith(expect.objectContaining({ trimStartS: 90 }), "Ana");
    expect(leave).toHaveBeenCalledOnce();
  });

  it("stays and shows why when saving is refused", async () => {
    fake.save.mockRejectedValue(new Error("Trim is too long."));
    await typeInFirstField("90");
    await tryToLeave();
    await click(popupButton("Save"));
    expect(leave).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Trim is too long.");
  });

  it("can leave without saving, or keep editing", async () => {
    await typeInFirstField("90");
    await tryToLeave();
    await click(popupButton("Keep editing"));
    expect(leave).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Save your changes?");
    await tryToLeave();
    await click(popupButton("Don't save"));
    expect(fake.save).not.toHaveBeenCalled();
    expect(leave).toHaveBeenCalledOnce();
  });
});
