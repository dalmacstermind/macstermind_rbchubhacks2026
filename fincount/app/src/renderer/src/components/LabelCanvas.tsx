// The full picture with the AI's boxes. Step through the pictures this fish appears in (camouflaged
// fish often only show when they move), and draw a box around an organism the AI missed.
// Boxes are drawn over the <img>; the picture itself is never changed.
import { useRef, useState } from "react";
import type { Frame } from "../../../shared/survey";
import { btnGhost } from "../ui";

type Box = { x: number; y: number; w: number; h: number }; // % of the picture

export function LabelCanvas({
  frames,
  frameIds,
  startId,
  highlight,
  onDraw,
}: {
  frames: Map<string, Frame>;
  frameIds: string[];
  startId: string;
  highlight: string; // track id of the fish being labelled
  onDraw: (frameId: string, box: Box) => void;
}) {
  const [index, setIndex] = useState(Math.max(0, frameIds.indexOf(startId)));
  const [drawing, setDrawing] = useState(false);
  const [drag, setDrag] = useState<{ x0: number; y0: number; box: Box } | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const frame = frames.get(frameIds[Math.min(index, frameIds.length - 1)] ?? startId);
  if (!frame) return <p className="text-sm text-muted-foreground">This picture isn't available.</p>;

  // Mouse position as a percentage of the picture.
  const at = (e: React.MouseEvent) => {
    const r = area.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
  };
  const box = (x0: number, y0: number, x1: number, y1: number): Box => ({
    x: Math.max(0, Math.min(x0, x1)),
    y: Math.max(0, Math.min(y0, y1)),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  });

  return (
    <div>
      <div
        ref={area}
        className={`relative select-none overflow-hidden rounded-xl border border-border ${drawing ? "cursor-crosshair" : ""}`}
        onMouseDown={(e) => drawing && setDrag({ ...at(e), x0: at(e).x, y0: at(e).y, box: { x: 0, y: 0, w: 0, h: 0 } })}
        onMouseMove={(e) => drag && setDrag({ ...drag, box: box(drag.x0, drag.y0, at(e).x, at(e).y) })}
        onMouseUp={() => {
          if (drag && drag.box.w > 0.5 && drag.box.h > 0.5) onDraw(frame.id, drag.box);
          setDrag(null);
          setDrawing(false);
        }}
      >
        <img src={frame.image} alt={`Picture at ${frame.timestamp}`} className="block w-full" draggable={false} />
        {frame.detections.map((d) => (
          <span
            key={d.id}
            style={{ left: `${d.box.x}%`, top: `${d.box.y}%`, width: `${d.box.w}%`, height: `${d.box.h}%` }}
            className={`pointer-events-none absolute border-2 ${d.trackId === highlight ? "border-primary ring-4 ring-primary/40" : "border-dashed border-white/70"}`}
          />
        ))}
        {drag && (
          <span
            style={{ left: `${drag.box.x}%`, top: `${drag.box.y}%`, width: `${drag.box.w}%`, height: `${drag.box.h}%` }}
            className="pointer-events-none absolute border-2 border-warning"
          />
        )}
        <span className="absolute bottom-2 left-2 rounded bg-background/85 px-2 py-0.5 font-mono text-xs">
          {frame.source} · {frame.timestamp}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-sm">
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
        </div>
        <button className={btnGhost} onClick={() => setDrawing(!drawing)} aria-pressed={drawing}>
          {drawing ? "Drag on the picture…" : "Draw a missed fish"}
        </button>
      </div>
    </div>
  );
}
