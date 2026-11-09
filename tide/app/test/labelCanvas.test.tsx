// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Frame } from "../src/shared/survey";
import { LabelCanvas } from "../src/renderer/src/components/LabelCanvas";
import { NORMAL_LOOK, type PictureLook } from "../src/renderer/src/components/PictureControls";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const frame = {
  id: "f1",
  image: "pic.jpg",
  source: "a.mp4",
  timestamp: "00:01:00",
  detections: [{ id: "d1", trackId: "t1", box: { x: 10, y: 10, w: 20, h: 20 } }],
} as unknown as Frame;

let host: HTMLDivElement;
let root: Root;
const onDraw = vi.fn();
const onLook = vi.fn();
const show = (look: PictureLook = NORMAL_LOOK) =>
  act(() =>
    root.render(
      <LabelCanvas
        frames={new Map([["f1", frame]])}
        frameIds={["f1"]}
        startId="f1"
        highlight="t1"
        look={look}
        onLook={onLook}
        onDraw={onDraw}
      />,
    ),
  );
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name || b.getAttribute("aria-label") === name)!;
const picture = () => host.querySelector("img")!;
const pointer = (type: string, clientX: number, clientY: number) =>
  act(() => {
    picture().parentElement!.parentElement!.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY }));
  });

beforeEach(() => {
  onDraw.mockReset();
  onLook.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("LabelCanvas", () => {
  it("zooms the picture in and out", () => {
    show();
    const size = () => picture().parentElement!.style.width;
    expect(size()).toBe("100%");
    expect(button("Zoom out").disabled).toBe(true);
    act(() => button("Zoom in").click());
    expect(size()).toBe("125%");
    act(() => button("Zoom out").click());
    expect(size()).toBe("100%");
  });

  it("shows brightness and contrast on the picture only", () => {
    show({ brightness: 150, contrast: 80 });
    expect(picture().style.filter).toBe("brightness(150%) contrast(80%)");
    expect(host.querySelector<HTMLElement>("span.absolute")!.style.filter).toBe(""); // boxes stay as they are
  });

  it("resets the zoom and the look", () => {
    show({ brightness: 150, contrast: 80 });
    act(() => button("Zoom in").click());
    act(() => button("Reset view").click());
    expect(picture().parentElement!.style.width).toBe("100%");
    expect(onLook).toHaveBeenCalledWith(NORMAL_LOOK);
  });

  it("reports a drawn box as % of the picture, even when zoomed", () => {
    show();
    act(() => button("Zoom in").click());
    // The picture is on screen 1000 × 500 and scrolled 100 px across.
    picture().parentElement!.getBoundingClientRect = () =>
      ({ left: -100, top: 0, width: 1000, height: 500 }) as DOMRect;
    act(() => button("Draw a missed fish").click());
    pointer("pointerdown", 100, 50);
    pointer("pointermove", 300, 150);
    pointer("pointerup", 300, 150);
    expect(onDraw).toHaveBeenCalledWith("f1", { x: 20, y: 10, w: 20, h: 20 });
  });
});
