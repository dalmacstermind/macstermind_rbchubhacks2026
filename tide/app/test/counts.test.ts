import { describe, expect, it } from "vitest";
import type { CountStatus } from "../src/shared/api";
import { countsThatEnded, taskbarProgress } from "../src/renderer/src/counts";

const count = (videoId: number, state: CountStatus["state"], percent: number | null = null): CountStatus => ({
  videoId,
  surveyId: 1,
  site: "Site",
  fileName: "a.mp4",
  state,
  detail: "",
  percent,
});

describe("taskbarProgress", () => {
  it("follows the running video, is busy without a percentage, and clears when nothing is counting", () => {
    expect(taskbarProgress([count(1, "queued"), count(2, "running", 25)])).toBe(0.25);
    expect(taskbarProgress([count(1, "running", null)])).toBeGreaterThan(1);
    expect(taskbarProgress([count(1, "queued")])).toBeGreaterThan(1);
    expect(taskbarProgress([count(1, "done"), count(2, "stopped")])).toBeNull();
  });
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
