import { describe, expect, it } from "vitest";
import { moveOldSettings } from "../src/renderer/src/oldSettings";

/** A tiny stand-in for the browser's localStorage. */
function fakeStorage(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("moving settings saved under the old name", () => {
  it("moves fincount.* keys to tide.*", () => {
    const s = fakeStorage({ "fincount.theme": "dark", "fincount.lastPerson": "Alex", other: "kept" });
    moveOldSettings(s);
    expect(Object.fromEntries(s.data)).toEqual({ "tide.theme": "dark", "tide.lastPerson": "Alex", other: "kept" });
  });

  it("keeps a value already saved under the new name", () => {
    const s = fakeStorage({ "fincount.theme": "dark", "tide.theme": "light" });
    moveOldSettings(s);
    expect(Object.fromEntries(s.data)).toEqual({ "tide.theme": "light" });
  });

  it("does nothing when there are no old settings, and never throws", () => {
    const s = fakeStorage({ "tide.prefs": "{}" });
    moveOldSettings(s);
    expect(Object.fromEntries(s.data)).toEqual({ "tide.prefs": "{}" });
    const broken = {
      ...s,
      key: () => {
        throw new Error("no storage");
      },
    };
    expect(() => moveOldSettings(broken)).not.toThrow();
  });
});
