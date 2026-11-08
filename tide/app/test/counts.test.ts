import { describe, expect, it } from "vitest";
import type { CountStatus } from "../src/shared/api";
import { countsThatEnded } from "../src/renderer/src/counts";

const count = (videoId: number, state: CountStatus["state"]): CountStatus => ({
  videoId,
  surveyId: 1,
  site: "Site",
  fileName: "a.mp4",
  state,
  detail: "",
});

describe("countsThatEnded", () => {
  it("finds counts that were going and have finished or failed", () => {
    const before = new Map([
      [1, "running"],
      [2, "queued"],
      [3, "done"],
      [4, "running"],
    ]);
    const now = [count(1, "done"), count(2, "failed"), count(3, "done"), count(4, "stopped")];
    expect(countsThatEnded(before, now).map((c) => c.videoId)).toEqual([1, 2]); // 3 ended earlier; 4 was stopped by a person
  });
});
