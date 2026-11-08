// The full picture with the AI's boxes, large enough to work on. Step through the pictures this fish
// appears in (camouflaged fish often only show when they move), zoom in, brighten murky water, and draw
// a box around an organism the AI missed. Brightness, contrast and zoom only change how the picture looks
// here: the saved picture is never changed, and boxes are kept as % of the picture at any zoom.
import { useLayoutEffect, useRef, useState } from "react";
import type { Frame } from "../../../shared/survey";
import { btnGhost } from "../ui";
import { PictureControls, MAX_ZOOM, MIN_ZOOM, NORMAL_LOOK, type PictureLook } from "./PictureControls";

type Box = { x: number; y: number; w: number; h: number }; // % of the picture

export function LabelCanvas({
  frames,
  frameIds,
  startId,
  highlight,
  look,
  onLook,
  pending,
  onDraw,
}: {
  frames: Map<string, Frame>;
  frameIds: string[];
  startId: string;
  highlight: string; // track id of the fish being labelled
  look: PictureLook;
  onLook: (look: PictureLook) => void;
  pending?: { frameId: string; box: Box } | null; // a box drawn but not labelled yet
  onDraw: (frameId: string, box: Box) => void;
}) {
  const [index, setIndex] = useState(Math.max(0, frameIds.indexOf(startId)));
  const [drawing, setDrawing] = useState(false);
  const [drag, setDrag] = useState<{ x0: number; y0: number; box: Box } | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const scroller = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const keepCentred = useRef<{ x: number; y: number } | null>(null); // part of the picture (0–1) to keep in view

  // After zooming, scroll so the same part of the picture stays in the middle.
  useLayoutEffect(() => {
    const s = scroller.current;
    const c = keepCentred.current;
    if (!s || !c) return;
    s.scrollLeft = c.x * s.scrollWidth - s.clientWidth / 2;
    s.scrollTop = c.y * s.scrollHeight - s.clientHeight / 2;
    keepCentred.current = null;
  }, [zoom]);

  const frame = frames.get(frameIds[Math.min(index, frameIds.length - 1)] ?? startId);
  if (!frame) return <p className="text-sm text-muted-foreground">This picture isn't available.</p>;

  // The first zoom goes to the fish being labelled; after that it stays on whatever is in the middle.
  const changeZoom = (value: number) => {
    const s = scroller.current!;
    const fish = zoom === MIN_ZOOM ? frame.detections.find((d) => d.trackId === highlight) : undefined;
    keepCentred.current = fish
      ? { x: (fish.box.x + fish.box.w / 2) / 100, y: (fish.box.y + fish.box.h / 2) / 100 }
      : {
          x: (s.scrollLeft + s.clientWidth / 2) / s.scrollWidth,
          y: (s.scrollTop + s.clientHeight / 2) / s.scrollHeight,
        };
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value)));
  };

  // Pointer position as a percentage of the picture, kept inside the picture.
  const at = (e: React.PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    const percent = (offset: number, size: number) => Math.min(100, Math.max(0, (offset / size) * 100));
    return { x: percent(e.clientX - r.left, r.width), y: percent(e.clientY - r.top, r.height) };
  };

  // Dragging draws a box in drawing mode; otherwise it moves a zoomed picture around. Capturing the
  // pointer keeps the drag going even if the mouse leaves the picture.
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawing && zoom === MIN_ZOOM) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (drawing) {
      const p = at(e);
      setDrag({ x0: p.x, y0: p.y, box: { x: p.x, y: p.y, w: 0, h: 0 } });
    } else {
      pan.current = { x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop };
    }
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag) {
      const p = at(e);
      setDrag({
        ...drag,
        box: {
          x: Math.min(drag.x0, p.x),
          y: Math.min(drag.y0, p.y),
          w: Math.abs(p.x - drag.x0),
          h: Math.abs(p.y - drag.y0),
        },
      });
    } else if (pan.current) {
      e.currentTarget.scrollLeft = pan.current.left - (e.clientX - pan.current.x);
      e.currentTarget.scrollTop = pan.current.top - (e.clientY - pan.current.y);
    }
  };
  const end = () => {
    pan.current = null;
    if (!drag) return;
    if (drag.box.w > 0.5 && drag.box.h > 0.5) onDraw(frame.id, drag.box);
    setDrag(null);
    setDrawing(false);
  };

  const shownBox = drag?.box ?? (pending?.frameId === frame.id ? pending.box : null);
  const cursor = drawing ? "cursor-crosshair" : zoom > MIN_ZOOM ? "cursor-grab" : "";
  return (
    <div className="space-y-3">
      <PictureControls
        zoom={zoom}
        onZoom={changeZoom}
        look={look}
        onLook={onLook}
        onReset={() => {
          changeZoom(MIN_ZOOM);
          onLook(NORMAL_LOOK);
        }}
      />
      <div
        ref={scroller}
        className={`max-h-[64vh] select-none overflow-auto rounded-xl border border-border ${cursor}`}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
      >
        <div ref={area} className="relative" style={{ width: `${zoom}%` }}>
          <img
            src={frame.image}
            alt={`Picture at ${frame.timestamp}`}
            className="block w-full"
            style={{ filter: `brightness(${look.brightness}%) contrast(${look.contrast}%)` }}
            draggable={false}
          />
          {frame.detections.map((d) => (
            <span
              key={d.id}
              style={{ left: `${d.box.x}%`, top: `${d.box.y}%`, width: `${d.box.w}%`, height: `${d.box.h}%` }}
              className={`pointer-events-none absolute border-2 ${d.trackId === highlight ? "border-primary ring-4 ring-primary/40" : "border-dashed border-white/70"}`}
            />
          ))}
          {shownBox && (
            <span
              style={{
                left: `${shownBox.x}%`,
                top: `${shownBox.y}%`,
                width: `${shownBox.w}%`,
                height: `${shownBox.h}%`,
              }}
              className="pointer-events-none absolute border-2 border-warning"
            />
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          <button
            className={btnGhost}
            disabled={index === 0}
            onClick={() => setIndex(index - 1)}
            aria-label="Previous picture"
          >
            ←
          </button>
          <span className="text-muted-foreground">
            {index + 1} of {frameIds.length}
          </span>
          <button
            className={btnGhost}
            disabled={index >= frameIds.length - 1}
            onClick={() => setIndex(index + 1)}
            aria-label="Next picture"
          >
            →
          </button>
          <span className="font-mono text-xs text-muted-foreground">{frame.timestamp}</span>
        </div>
        <button className={btnGhost} onClick={() => setDrawing(!drawing)} aria-pressed={drawing}>
          {drawing ? "Drag on the picture…" : "Draw a missed fish"}
        </button>
      </div>
    </div>
  );
}
