// The labelled invertebrates for the "reef" splash: a crab on the sea floor and a darting shrimp,
// each with a teal box and label like the ones the app draws on survey video. Pure decoration.

/** The teal detection box (draws itself in) and its label (fades in a moment later). */
function Detection({
  x,
  y,
  w,
  h,
  label,
  labelW,
  at,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  labelW: number;
  at: number;
}) {
  return (
    <>
      <rect
        className="tide-box"
        pathLength={260}
        style={{ animationDelay: `${at}s` }}
        x={x}
        y={y}
        width={w}
        height={h}
        rx="4"
        fill="none"
        stroke="var(--detect)"
        strokeWidth="2"
      />
      <g className="tide-fade" style={{ animationDelay: `${at + 0.5}s` }}>
        <rect x={x} y={y - 20} width={labelW} height="18" rx="3" fill="var(--detect)" />
        <text
          x={x + 6}
          y={y - 7}
          fontSize="11"
          fontWeight="600"
          fill="oklch(0.18 0.04 240)"
          fontFamily="Manrope, sans-serif"
        >
          {label}
        </text>
      </g>
    </>
  );
}

export function Crab() {
  const shell = "oklch(0.66 0.15 38)";
  return (
    <div className="reef-crab" style={{ bottom: "7vh", animationDelay: "-6.3s" }}>
      <svg width="124" height="90" viewBox="0 0 124 90">
        <g transform="translate(16 32) scale(1.3)">
          <g className="reef-crab-body">
            <g stroke={shell} strokeWidth="2.4" strokeLinecap="round" fill="none">
              <path d="M22 26 L9 31 M22 28 L10 36 M24 30 L14 39 M42 26 L55 31 M42 28 L54 36 M40 30 L50 39" />
              <path d="M21 20 Q13 16 10 11 M43 20 Q51 16 54 11 M28 16 L27 11 M36 16 L37 11" />
            </g>
            <ellipse cx="32" cy="24" rx="15" ry="9" fill={shell} />
            <ellipse cx="9" cy="8" rx="6" ry="4.5" fill={shell} />
            <ellipse cx="55" cy="8" rx="6" ry="4.5" fill={shell} />
            <path d="M5 5 L9 8 L4 9 Z M59 5 L55 8 L60 9 Z" fill="oklch(0.2 0.04 240)" />
            <circle cx="27" cy="10" r="1.8" fill="oklch(0.15 0.03 240)" />
            <circle cx="37" cy="10" r="1.8" fill="oklch(0.15 0.03 240)" />
          </g>
        </g>
        <Detection x={8} y={26} w={104} h={60} label="crab 0.87" labelW={64} at={4.5} />
      </svg>
    </div>
  );
}

export function Shrimp() {
  const body = "oklch(0.78 0.11 25 / 0.85)";
  return (
    <div className="reef-shrimp" style={{ top: "19%" }}>
      <svg width="124" height="76" viewBox="0 0 124 76">
        <g transform="translate(14 26) scale(1.3)">
          <g className="reef-shrimp-body">
            <path d="M8 18 C12 8 30 5 44 10 C50 12 54 16 52 20 C40 23 22 24 8 18 Z" fill={body} />
            <path d="M8 18 L1 12 L3 18 L1 24 Z" fill={body} />
            <g stroke="oklch(0.62 0.12 25 / 0.9)" strokeWidth="1.2" fill="none" strokeLinecap="round">
              <path d="M20 9 Q22 15 20 22 M28 7 Q30 14 28 22 M36 8 Q38 14 36 21" />
              <path d="M24 22 l-2 5 M30 22 l-2 5 M36 21 l-2 5 M50 12 Q56 4 62 0 M50 12 Q58 8 64 7" />
            </g>
            <circle cx="47" cy="12" r="1.6" fill="oklch(0.15 0.03 240)" />
          </g>
        </g>
        <Detection x={8} y={24} w={96} h={46} label="shrimp 0.78" labelW={76} at={6} />
      </svg>
    </div>
  );
}
