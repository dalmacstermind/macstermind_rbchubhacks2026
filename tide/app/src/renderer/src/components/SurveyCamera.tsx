// An underwater survey camera lowered on a cable from the surface, on the right of the "reef"
// splash: a housing with one big lens, side clasps and two video lights. It sinks into view,
// sways on its cable, turns its lens to look around, and its shutter "blinks" now and then.
// Pure decoration; animations are in Reef.css.

const LENS = { x: 100, y: 336 };

export function SurveyCamera() {
  return (
    <svg aria-hidden="true" className="reef-cam-drop absolute right-[7%] top-0 h-[50vh]" viewBox="0 0 200 420"
      overflow="visible">
      <defs>
        <radialGradient id="reef-glass" cx="0.35" cy="0.35" r="0.75">
          <stop offset="0" stopColor="oklch(0.72 0.1 220)" />
          <stop offset="0.6" stopColor="oklch(0.26 0.06 245)" />
          <stop offset="1" stopColor="oklch(0.12 0.03 250)" />
        </radialGradient>
        <radialGradient id="reef-lamp" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="oklch(0.98 0.05 95)" stopOpacity="0.9" />
          <stop offset="1" stopColor="oklch(0.98 0.05 95)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Everything below swings from the top of the cable */}
      <g className="reef-cam-swing">
        <line x1="100" y1="-40" x2="100" y2="270" stroke="oklch(0.82 0.03 220 / 0.7)" strokeWidth="2.5" />

        {/* Carry handle the cable is clipped to */}
        <path d="M64 298 V282 Q64 270 76 270 H124 Q136 270 136 282 V298" fill="none"
          stroke="oklch(0.3 0.02 240)" strokeWidth="7" strokeLinecap="round" />
        <circle cx="100" cy="270" r="5" fill="oklch(0.55 0.02 240)" />

        {/* Video lights on short arms, glowing softly */}
        {[24, 176].map((x) => (
          <g key={x}>
            <line x1={x < 100 ? 46 : 154} y1="320" x2={x} y2="320" stroke="oklch(0.3 0.02 240)" strokeWidth="5" />
            <circle className="reef-lamp-glow" cx={x} cy="320" r="22" fill="url(#reef-lamp)" />
            <rect x={x - 8} y="310" width="16" height="20" rx="4" fill="oklch(0.28 0.02 240)" />
            <rect x={x - 5} y="313" width="10" height="14" rx="2" fill="oklch(0.95 0.06 95)" />
          </g>
        ))}

        {/* Housing: yellow body, dark faceplate, side clasps */}
        <rect x="46" y="296" width="108" height="88" rx="14" fill="oklch(0.78 0.14 85)" />
        <rect x="40" y="318" width="8" height="30" rx="3" fill="oklch(0.32 0.02 240)" />
        <rect x="152" y="318" width="8" height="30" rx="3" fill="oklch(0.32 0.02 240)" />
        <rect x="56" y="304" width="88" height="64" rx="9" fill="oklch(0.24 0.02 240)" />
        <rect x="62" y="310" width="12" height="8" rx="2" fill="oklch(0.45 0.06 220)" />
        <circle className="reef-rec" cx="136" cy="314" r="3.5" fill="oklch(0.65 0.24 25)" />
        <text x="100" y="379" textAnchor="middle" fontSize="8" fontWeight="700" letterSpacing="1.5"
          fill="oklch(0.35 0.05 80)" fontFamily="Sora, sans-serif">RUV · TIDE</text>

        {/* The lens turns a little to look around */}
        <g className="reef-cam-look">
          <circle cx={LENS.x} cy={LENS.y} r="25" fill="oklch(0.72 0.01 240)" />
          <circle cx={LENS.x} cy={LENS.y} r="21" fill="oklch(0.18 0.02 240)" />
          <circle cx={LENS.x} cy={LENS.y} r="16" fill="url(#reef-glass)" />
          <circle cx={LENS.x} cy={LENS.y} r="8" fill="none" stroke="oklch(0.5 0.08 220 / 0.6)" strokeWidth="1.5" />
          <circle cx={LENS.x - 6} cy={LENS.y - 6} r="3.5" fill="oklch(1 0 0 / 0.8)" />
          <circle cx={LENS.x + 5} cy={LENS.y + 6} r="1.5" fill="oklch(1 0 0 / 0.5)" />
          {/* Shutter: closes over the glass for a moment, then opens */}
          <circle className="reef-cam-shutter" cx={LENS.x} cy={LENS.y} r="16" fill="oklch(0.1 0.02 250)" />
        </g>
      </g>
    </svg>
  );
}
