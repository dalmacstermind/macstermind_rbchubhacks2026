import { describe, expect, it } from "vitest";
import { UNKNOWN, aiSure, isCounted, needsReview, type Detection } from "../src/shared/survey";

const det = (over: Partial<Detection>): Detection => ({
  id: "1",
  speciesId: UNKNOWN,
  modelSpeciesId: UNKNOWN,
  confidence: 0.23,
  verified: false,
  box: { x: 0, y: 0, w: 1, h: 1 },
  trackId: "v-p1-t1",
  ...over,
});

describe("only fish the AI isn't sure of need a person", () => {
  it("a clear species match counts without checking, however faint the box", () => {
    const sure = det({ speciesId: "cod", modelSpeciesId: "cod", aiLabel: "cod", unknownReason: "" });
    expect(aiSure(sure)).toBe(true);
    expect(needsReview(sure, 0.4)).toBe(false);
    expect(isCounted(sure, 0.4)).toBe(true);
  });

  it("an unclear match is Unknown and waits for a person to pick the species", () => {
    const unsure = det({ aiLabel: "Unknown", unknownReason: "Two or more species look equally likely." });
    expect(aiSure(unsure)).toBe(false);
    expect(needsReview(unsure, 0.4)).toBe(true);
    expect(isCounted(unsure, 0.4)).toBe(false);
  });

  it("a closest-match guess (with a reason) is not sure", () => {
    const guess = det({
      speciesId: "cod",
      modelSpeciesId: "cod",
      aiLabel: "cod",
      unknownReason: "Closest match (0.6)",
    });
    expect(aiSure(guess)).toBe(false);
    expect(needsReview(guess, 0.4)).toBe(true);
  });

  it("demo data (no species model) keeps the old rule", () => {
    const demo = det({ speciesId: "cod", modelSpeciesId: "cod", aiLabel: undefined, trackId: undefined });
    expect(aiSure(demo)).toBe(false);
    expect(needsReview(demo, 0.4)).toBe(true);
  });
});
