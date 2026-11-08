import { describe, expect, it } from "vitest";
import type { Reference } from "../src/shared/api";
import type { Species } from "../src/shared/survey";
import {
  describeSource,
  filterSpecies,
  imageCount,
  isNew,
  knownScientific,
  sortSpecies,
} from "../src/renderer/src/speciesRegistry";

const sp = (common: string, scientific = "—"): Species => ({
  id: common.toLowerCase(),
  common,
  scientific,
  status: "native",
  habitat: "Marine",
});

const ref = (over: Partial<Reference>): Reference => ({
  id: "1",
  speciesId: "cunner",
  image: "",
  source: "",
  addedBy: "Alex",
  addedAt: "2026-11-08 10:00:00",
  surveyId: null,
  surveySite: "",
  sourceFile: "",
  sourceTime: "",
  ...over,
});

describe("Species Registry helpers", () => {
  it("sorts alphabetically by common name, ignoring case", () => {
    const sorted = sortSpecies([sp("Pollock"), sp("black sea bass"), sp("Cunner")]);
    expect(sorted.map((s) => s.common)).toEqual(["black sea bass", "Cunner", "Pollock"]);
  });

  it("searches common and scientific names", () => {
    const list = [sp("Cunner", "Tautogolabrus adspersus"), sp("Pollock", "Pollachius virens")];
    expect(filterSpecies(list, "cun").map((s) => s.common)).toEqual(["Cunner"]);
    expect(filterSpecies(list, "VIRENS").map((s) => s.common)).toEqual(["Pollock"]);
    expect(filterSpecies(list, "  ")).toHaveLength(2);
    expect(filterSpecies(list, "cod")).toEqual([]);
  });

  it("marks species added in the last 7 days as new", () => {
    const now = new Date("2026-11-08T12:00:00");
    expect(isNew("2026-11-08 09:00:00", now)).toBe(true);
    expect(isNew("2026-11-01 12:00:00", now)).toBe(true); // exactly 7 days
    expect(isNew("2026-10-31 11:00:00", now)).toBe(false);
    expect(isNew("", now)).toBe(false); // came with the app
    expect(isNew("not a date", now)).toBe(false);
  });

  it("counts images and hides an unknown scientific name", () => {
    expect([imageCount(0), imageCount(1), imageCount(5), imageCount(undefined)]).toEqual([
      "0 images",
      "1 image",
      "5 images",
      "0 images",
    ]);
    expect(knownScientific("—")).toBe("");
    expect(knownScientific("Gadus morhua")).toBe("Gadus morhua");
  });

  it("says where a picture came from", () => {
    expect(
      describeSource(
        ref({ surveyId: 4, surveySite: "Mahone Bay", sourceFile: "GX010021.MP4", sourceTime: "00:06:00" }),
      ),
    ).toBe('Survey "Mahone Bay" · GX010021.MP4 at 00:06:00');
    expect(describeSource(ref({ surveyId: 4, sourceFile: "photo.jpg" }))).toBe("Survey 4 · photo.jpg");
    expect(describeSource(ref({ source: "cunner_side.jpg" }))).toBe("cunner_side.jpg"); // uploaded
    expect(describeSource(ref({}))).toBe("Not recorded");
  });
});
