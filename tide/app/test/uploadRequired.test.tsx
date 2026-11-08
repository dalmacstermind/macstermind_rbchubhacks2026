// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FUTURE_DATE_MESSAGE, today } from "../src/renderer/src/ui";
import { UploadView, type SurveyForm } from "../src/renderer/src/views/Upload";

vi.mock("../src/renderer/src/api", () => ({ api: {} }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const form = (site: string, surveyDate: string): SurveyForm =>
  ({
    site,
    surveyDate,
    threshold: 0.5,
    sampling: 1,
    enhance: true,
    ignoreSpecks: true,
    lookCloser: false,
  }) as SurveyForm;

let host: HTMLDivElement;
let root: Root;
const onStart = vi.fn();
const show = (f: SurveyForm) =>
  act(() =>
    root.render(
      <UploadView
        files={[{ path: "C:/a.mp4", name: "a.mp4", size: 1 }]}
        setFiles={() => undefined}
        form={f}
        setForm={() => undefined}
        error={null}
        onStart={onStart}
        overview={null}
        onOpen={() => undefined}
        onDeleted={() => undefined}
      />,
    ),
  );
const count = () => {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Count the fish"))!;
  act(() => button.click());
};

beforeEach(() => {
  onStart.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Survey details are required", () => {
  it("shows no message until someone tries to count", () => {
    show(form("", ""));
    expect(host.textContent).not.toContain("Enter Site name");
    expect(host.textContent).not.toContain("Enter filmed date");
  });

  it("stops the count and asks for both when they are empty", () => {
    show(form("   ", "")); // spaces alone are not a site name
    count();
    expect(onStart).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Enter Site name");
    expect(host.textContent).toContain("Enter filmed date");
  });

  it("asks only for what is missing, and clears the message once it is filled in", () => {
    show(form("Mahone Bay", ""));
    count();
    expect(onStart).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Enter Site name");
    expect(host.textContent).toContain("Enter filmed date");
    show(form("Mahone Bay", "2025-08-20"));
    expect(host.textContent).not.toContain("Enter filmed date");
  });

  it("doesn't allow a future date", () => {
    const input = () => host.querySelector<HTMLInputElement>('input[type="date"]')!;
    show(form("Mahone Bay", ""));
    expect(input().max).toBe(today()); // the calendar can't pick anything later
    show(form("Mahone Bay", "2999-01-01")); // but a date can still be typed in
    expect(host.textContent).toContain(FUTURE_DATE_MESSAGE);
    count();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("allows today", () => {
    show(form("Mahone Bay", today()));
    count();
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("starts counting when both are filled in", () => {
    show(form("Mahone Bay", "2025-08-20"));
    count();
    expect(onStart).toHaveBeenCalledOnce();
  });
});
