import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPECIES,
  NOT_FISH,
  frameCounts,
  openItems,
  qcDifference,
  summarize,
  type Detection,
  type Frame,
} from "../src/shared/survey";

const d = (id: string, s: string, c: number): Detection => ({
  id,
  speciesId: s,
  modelSpeciesId: s,
  confidence: c,
  verified: false,
  box: { x: 0, y: 0, w: 10, h: 10 },
});
const makeFrames = (): Frame[] => [
  {
    id: "f1",
    image: "",
    source: "a.mp4",
    timestamp: "00:00:12",
    detections: [d("d1", "cod", 0.94), d("d2", "cunner", 0.81), d("d3", "cod", 0.62), d("d4", "unknown", 0.41)],
  },
  {
    id: "f2",
    image: "",
    source: "b.mp4",
    timestamp: "00:01:47",
    detections: [d("d5", "bass", 0.89), d("d6", "pickerel", 0.77), d("d7", "trout", 0.48)],
  },
  {
    id: "f3",
    image: "",
    source: "c.mp4",
    timestamp: "00:03:05",
    detections: [
      d("d8", "mackerel", 0.91),
      d("d9", "mackerel", 0.88),
      d("d10", "mackerel", 0.84),
      d("d11", "flounder", 0.73),
    ],
  },
];

describe("survey summary", () => {
  it("counts fish with MaxN, not by adding every sighting", () => {
    const frames = makeFrames();
    // Same 3 mackerel seen again in a second picture: should still be 3 fish, 6 sightings.
    frames.push({ ...frames[2]!, id: "f4", timestamp: "00:03:06" });
    const s = summarize(frames, DEFAULT_SPECIES, 0.5);
    const mackerel = s.rows.find((r) => r.sp.id === "mackerel")!;
    expect(mackerel.maxN).toBe(3);
    expect(mackerel.sightings).toBe(6);
  });

  it("leaves unsure detections out of the count until a person confirms them", () => {
    const frames = makeFrames();
    const before = summarize(frames, DEFAULT_SPECIES, 0.5);
    expect(before.toReview).toBe(2); // 41% unknown fish and 48% "trout"

    frames[1]!.detections[2] = { ...frames[1]!.detections[2]!, speciesId: "bass", verified: true };
    const after = summarize(frames, DEFAULT_SPECIES, 0.5);
    expect(after.toReview).toBe(1);
    expect(after.rows.find((r) => r.sp.id === "bass")!.maxN).toBe(2);
    expect(after.invasive).toBe(before.invasive + 1);
  });

  it("drops anything marked as not a fish", () => {
    const frames = makeFrames();
    frames[0]!.detections[0] = {
      ...frames[0]!.detections[0]!,
      speciesId: NOT_FISH,
      verified: true,
    };
    expect(summarize(frames, DEFAULT_SPECIES, 0.5).rows.find((r) => r.sp.id === "cod")!.maxN).toBe(1);
  });

  it("counts invertebrates separately from fish", () => {
    const frames = makeFrames();
    frames[0]!.detections.push(d("c1", "green_crab", 0.9), d("c2", "green_crab", 0.88));
    const s = summarize(frames, DEFAULT_SPECIES, 0.5);
    expect(s.invertebrates).toBe(2);
    expect(s.total).toBe(summarize(makeFrames(), DEFAULT_SPECIES, 0.5).total); // fish total unchanged
    expect(s.rows.at(-1)!.sp.id).toBe("green_crab"); // invertebrates listed after fish
    expect(frameCounts(frames[0]!, DEFAULT_SPECIES, 0.5)).toEqual({ fish: 3, invertebrates: 2 });
  });

  it("lists open items for the export check", () => {
    const s = summarize(makeFrames(), DEFAULT_SPECIES, 0.5);
    expect(openItems(s, { done: 1, total: 2, agreement: 100, target: 95 }).map((i) => i.key)).toEqual(["review", "qc"]);
    expect(s.toLabel).toBe(0); // the unidentified fish is below 50%, so it's in "review", not "label"
  });

  it("measures blind QC difference against FinCount's count", () => {
    expect(qcDifference(2, 3)).toBeCloseTo(33.3, 1);
    expect(qcDifference(0, 0)).toBe(0);
    expect(qcDifference(1, 0)).toBe(100);
  });
});
