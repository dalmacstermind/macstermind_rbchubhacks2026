// Zoom, brightness and contrast for looking at a picture closely. They only change how it looks on screen.
import { btnGhost } from "../ui";

export type PictureLook = { brightness: number; contrast: number }; // percent; 100 = unchanged
export const NORMAL_LOOK: PictureLook = { brightness: 100, contrast: 100 };
export const MIN_ZOOM = 100;
export const MAX_ZOOM = 500;
const ZOOM_STEP = 25;

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-28 accent-primary"
      />
      <span className="w-9 tabular-nums text-foreground">{value}%</span>
    </label>
  );
}

export function PictureControls({
  zoom,
  onZoom,
  look,
  onLook,
  onReset,
}: {
  zoom: number;
  onZoom: (zoom: number) => void;
  look: PictureLook;
  onLook: (look: PictureLook) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <div className="flex items-center gap-1">
        <button
          className={`${btnGhost} px-3 py-1`}
          disabled={zoom <= MIN_ZOOM}
          onClick={() => onZoom(zoom - ZOOM_STEP)}
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          className={`${btnGhost} px-3 py-1`}
          disabled={zoom >= MAX_ZOOM}
          onClick={() => onZoom(zoom + ZOOM_STEP)}
          aria-label="Zoom in"
        >
          +
        </button>
      </div>
      <Slider label="Zoom" value={zoom} min={MIN_ZOOM} max={MAX_ZOOM} step={ZOOM_STEP} onChange={onZoom} />
      <Slider
        label="Brightness"
        value={look.brightness}
        min={50}
        max={250}
        step={5}
        onChange={(brightness) => onLook({ ...look, brightness })}
      />
      <Slider
        label="Contrast"
        value={look.contrast}
        min={50}
        max={250}
        step={5}
        onChange={(contrast) => onLook({ ...look, contrast })}
      />
      <button className={`${btnGhost} py-1`} onClick={onReset}>
        Reset view
      </button>
    </div>
  );
}
