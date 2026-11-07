import { describe, expect, it } from "vitest";
import { PROTOCOL_FIELDS, changedFields, describe as show, shown, stored } from "../src/renderer/src/protocolSettings";
import { PROTOCOL_DEFAULTS } from "./fixtures";

const DEFAULTS = PROTOCOL_DEFAULTS;

const field = (key: string) => PROTOCOL_FIELDS.find((f) => f.key === key)!;

describe("protocol settings on the Settings screen", () => {
  it("shows the analysis window in minutes and stores it in seconds", () => {
    expect(shown(field("lengthS"), DEFAULTS)).toBe(15);
    expect(stored(field("lengthS"), 12)).toBe(720);
    expect(shown(field("intervalS"), DEFAULTS)).toBe(60);
    expect(stored(field("intervalS"), 30)).toBe(30);
  });

  it("describes values with their units", () => {
    expect(show(field("lengthS"), DEFAULTS)).toBe("15 min");
    expect(show(field("contextS"), DEFAULTS)).toBe("±5 s");
    expect(show(field("qcSamplePct"), DEFAULTS)).toBe("10%");
    expect(show(field("trimStartS"), DEFAULTS)).toBe("60 s");
  });

  it("lists only the fields that changed, in screen order", () => {
    expect(changedFields(DEFAULTS, DEFAULTS)).toEqual([]);
    expect(changedFields(DEFAULTS, { ...DEFAULTS, qcSamplePct: 20, lengthS: 720, intervalS: 30 })).toEqual([
      { label: "Analysis window", from: "15 min", to: "12 min" },
      { label: "Subsample interval", from: "60 s", to: "30 s" },
      { label: "QC sample", from: "10%", to: "20%" },
    ]);
  });

  it("ignores values the screen doesn't edit", () => {
    expect(changedFields(DEFAULTS, { ...DEFAULTS, pointsPerWindow: 30 })).toEqual([]);
  });

  it("has every editable protocol value on the screen once", () => {
    const keys = PROTOCOL_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain("maxToleranceS");
  });
});
