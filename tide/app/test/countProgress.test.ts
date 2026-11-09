import { describe, expect, it } from "vitest";
import type { SurveyResults, VideoResult } from "../src/shared/api";
import { timeLeft } from "../src/renderer/src/components/CountProgress";
import { countProgress } from "../src/renderer/src/components/ProtocolResults";

const video = (v: Partial<VideoResult>): VideoResult =>
  ({ confirmedBy: "Ana", countState: "", countDetail: "", countPercent: null, countEtaS: null, ...v }) as VideoResult;
const survey = (...videos: VideoResult[]) => ({ videos }) as SurveyResults;

describe("counting progress", () => {
  it("is null when nothing is waiting or being counted", () => {
    expect(countProgress(null)).toBeNull();
    expect(countProgress(survey(video({ countState: "done" })))).toBeNull();
  });

  it("shows one running video's percent, stage and time left", () => {
    const p = countProgress(
      survey(video({ countState: "running", countPercent: 42, countDetail: "Identifying the species", countEtaS: 75 })),
    );
    expect(p).toEqual({ state: "running", percent: 42, detail: "Identifying the species", etaS: 75 });
  });

  it("averages over the survey's videos, with no time left while others still wait", () => {
    const p = countProgress(
      survey(
        video({ countState: "done" }),
        video({
          countState: "running",
          countPercent: 50,
          countDetail: "Searching the pictures for fish",
          countEtaS: 30,
        }),
        video({ countState: "queued", countDetail: "Waiting to count" }),
        video({ confirmedBy: "", countState: "" }), // not confirmed: not part of the count yet
      ),
    );
    expect(p).toEqual({
      state: "running",
      percent: 50,
      detail: "Searching the pictures for fish (2 videos to go)",
      etaS: null,
    });
  });

  it("says when everything is still waiting", () => {
    expect(countProgress(survey(video({ countState: "queued", countDetail: "Waiting to count" })))?.state).toBe(
      "queued",
    );
  });

  it("words the time left plainly", () => {
    expect(timeLeft(null)).toBe("Working out how long this takes…");
    expect(timeLeft(4)).toBe("Almost done");
    expect(timeLeft(41)).toBe("About 50 seconds left");
    expect(timeLeft(150)).toBe("About 3 minutes left");
    expect(timeLeft(60)).toBe("About 1 minute left");
  });
});

describe("stage from the status text", () => {
  it("drops the percentage and time left that the ring already shows", async () => {
    const { stageOf } = await import("../src/renderer/src/components/CountProgress");
    expect(stageOf("Identifying the species: 93% · less than a minute left")).toBe("Identifying the species");
    expect(stageOf("Counting the points: 5%")).toBe("Counting the points");
    expect(stageOf("Loading the models")).toBe("Loading the models");
  });
});
