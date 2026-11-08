// A see-through layer over a picture: drag to draw a box around a fish the AI missed.
// The box is reported in % of the picture (like every box in the app); the picture isn't changed.
import { useRef, useState } from "react";

type Box = { x: number; y: number; w: number; h: number };

export function DrawLayer({ onDrawn }: { onDrawn: (box: Box) => void }) {
  const area = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; box: Box } | null>(null);

  // Mouse position as a percentage of the picture.
  const at = (e: React.MouseEvent) => {
    const r = area.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
  };

  return (
    <div
      ref={area}
      className="absolute inset-0 z-10 cursor-crosshair"
      onMouseDown={(e) => {
        const p = at(e);
        setDrag({ x0: p.x, y0: p.y, box: { x: p.x, y: p.y, w: 0, h: 0 } });
      }}
      onMouseMove={(e) => {
        if (!drag) return;
        const p = at(e);
        setDrag({
          ...drag,
          box: {
            x: Math.max(0, Math.min(drag.x0, p.x)),
            y: Math.max(0, Math.min(drag.y0, p.y)),
            w: Math.abs(p.x - drag.x0),
            h: Math.abs(p.y - drag.y0),
          },
        });
      }}
      onMouseUp={() => {
        if (drag && drag.box.w > 0.5 && drag.box.h > 0.5) onDrawn(drag.box);
        setDrag(null);
      }}
    >
      {drag && (
        <span
          style={{ left: `${drag.box.x}%`, top: `${drag.box.y}%`, width: `${drag.box.w}%`, height: `${drag.box.h}%` }}
          className="pointer-events-none absolute border-2 border-warning"
        />
      )}
    </div>
  );
}
