// "Completed" on the Surveys page: nothing left to count or check. Blind QC doesn't decide it.
import { describe, expect, it } from "vitest";
import { isSurveyComplete, type OpenItem } from "../src/shared/survey";

const item = (key: OpenItem["key"]): OpenItem => ({ key, text: key });

describe("isSurveyComplete", () => {
  it("is complete when nothing is open", () => {
    expect(isSurveyComplete([])).toBe(true);
  });

  it("ignores Blind QC", () => {
    expect(isSurveyComplete([item("qc")])).toBe(true);
  });

  it("is pending while a window, count, possible fish or Unknown fish is open", () => {
    for (const key of ["window", "count", "review", "label"] as const) {
      expect(isSurveyComplete([item(key)])).toBe(false);
      expect(isSurveyComplete([item("qc"), item(key)])).toBe(false);
    }
  });
});
