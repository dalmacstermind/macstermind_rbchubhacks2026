// @vitest-environment jsdom
// The Species Registry page in a simulated browser page (jsdom, a test-only tool): cards, search,
// opening a species, Esc, focus going back to the card, and the "no images" message.
// The back end is replaced by a small fake (vi.mock), so no server is needed.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Reference } from "../src/shared/api";
import type { Species } from "../src/shared/survey";
import { SpeciesView } from "../src/renderer/src/views/Species";

// Tells React these updates happen inside tests (so act() waits for them).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fake = vi.hoisted(() => ({ refs: {} as Record<string, Reference[]> }));
vi.mock("../src/renderer/src/api", () => ({
  api: {
    species: {
      list: vi.fn(async () => []),
      update: vi.fn(),
      remove: vi.fn(),
      reset: vi.fn(),
      references: { list: vi.fn(async (id: string) => fake.refs[id] ?? []), add: vi.fn(), remove: vi.fn() },
    },
  },
}));

const sp = (id: string, common: string, scientific: string, referenceCount: number): Species => ({
  id,
  common,
  scientific,
  status: "native",
  habitat: "Marine",
  referenceCount,
  thumbnail: referenceCount ? `http://127.0.0.1/references/${id}-1/image` : null,
});
const SPECIES = [
  sp("pollock", "Pollock", "Pollachius virens", 2),
  sp("cunner", "Cunner", "Tautogolabrus adspersus", 1),
  sp("bass", "black sea bass", "Centropristis striata", 0),
];
const picture = (id: string, sourceFile: string): Reference => ({
  id,
  speciesId: "pollock",
  image: `http://127.0.0.1/references/${id}/image`,
  source: sourceFile,
  addedBy: "Alex",
  addedAt: "2026-11-08 10:00:00",
  surveyId: 4,
  surveySite: "Mahone Bay",
  sourceFile,
  sourceTime: "00:06:00",
});
fake.refs = { pollock: [picture("p1", "GX010021.MP4"), picture("p2", "GX010022.MP4")] };

let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(<SpeciesView species={SPECIES} setSpecies={() => {}} person={{ name: "Alex", role: "" }} />),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const cards = () => [...container.querySelectorAll<HTMLButtonElement>('ul[aria-label="Species"] > li > button')];
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const type = async (input: HTMLInputElement, text: string) => {
  // React listens for "input" events; set the value the way a browser does, then send the event.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  await act(async () => input.dispatchEvent(new Event("input", { bubbles: true })));
};
const open = async (card: HTMLButtonElement) => {
  card.focus(); // like a keyboard user who tabbed to the card
  await act(async () => card.click());
  await act(async () => {}); // let the pictures load
};

describe("Species Registry page", () => {
  it("is called Species Registry", () => {
    expect(container.textContent).toContain("Species Registry · 3");
  });

  it("shows cards alphabetically with name, scientific name and image count", () => {
    const c = cards();
    expect(c.map((b) => b.querySelector(".font-semibold")!.textContent)).toEqual([
      "black sea bass",
      "Cunner",
      "Pollock",
    ]);
    expect(c[2]!.querySelector(".italic")!.textContent).toBe("Pollachius virens");
    expect(c.map((b) => b.textContent!.match(/\d+ images?/)![0])).toEqual(["0 images", "1 image", "2 images"]);
    const thumb = c[2]!.querySelector("img")!;
    expect(thumb.getAttribute("loading")).toBe("lazy");
    expect(c[0]!.querySelector("img")).toBeNull(); // no pictures: placeholder instead
  });

  it("filters the cards as you type", async () => {
    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search species"]')!;
    await type(search, "pollach");
    expect(cards().map((b) => b.querySelector(".font-semibold")!.textContent)).toEqual(["Pollock"]);
    await type(search, "zzz");
    expect(cards()).toHaveLength(0);
    expect(container.textContent).toContain("No species match");
  });

  it("opens a card's images, and Esc closes the dialog and returns focus to the card", async () => {
    const pollock = cards()[2]!;
    await open(pollock);
    const d = dialog()!;
    expect(d.getAttribute("aria-label")).toBe("Pollock");
    expect(d.textContent).toContain("Pollachius virens");
    const thumbs = d.querySelectorAll('section[aria-label="Reference images"] ul button');
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0]!.getAttribute("aria-label")).toContain("GX010021.MP4 at 00:06:00");

    await act(async () => (thumbs[1] as HTMLButtonElement).click()); // show the second picture large
    expect(dialog()!.textContent).toContain('Survey "Mahone Bay" · GX010022.MP4 at 00:06:00');
    expect(dialog()!.textContent).toContain("Remove image");

    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(pollock);
  });

  it("says so when a species has no images yet", async () => {
    await open(cards()[0]!); // black sea bass, 0 pictures
    expect(dialog()!.textContent).toContain("No reference images yet");
  });

  it("closes with the Close button too", async () => {
    await open(cards()[1]!);
    const close = [...dialog()!.querySelectorAll("button")].find((b) => b.textContent === "Close")!;
    await act(async () => close.click());
    expect(dialog()).toBeNull();
  });
});
