// The animated underwater background for the start-up splash: light rays, bubbles, fish and waves.
// Pure decoration (hidden from screen readers). Animations live in Splash.css.
import type { CSSProperties } from "react";

// A simple fish shape facing right (body + tail), drawn in a 48 × 24 box.
const FISH = "M10 12 C18 2 38 2 46 12 C38 22 18 22 10 12 Z M10 12 L0 4 L3 12 L0 20 Z";

// One wave repeated four times across 2880 px, so sliding it left by half loops without a jump.
const WAVE = "M0 60 Q180 20 360 60 T720 60 T1080 60 T1440 60 T1800 60 T2160 60 T2520 60 T2880 60 V120 H0 Z";

// Fixed positions (not random) so the scene looks the same every time the app opens.
const RAYS = [8, 27, 52, 74];
const BUBBLES = Array.from({ length: 16 }, (_, i) => ({
  left: (i * 37 + 11) % 100,
  size: 6 + ((i * 7) % 14),
  duration: 7 + ((i * 3) % 6),
  delay: -((i * 1.3) % 9),
}));
const SCHOOL = [
  { top: 22, size: 34, duration: 19, delay: -3, opacity: 0.35 },
  { top: 26, size: 26, duration: 21, delay: -9, opacity: 0.28 },
  { top: 78, size: 40, duration: 16, delay: -12, opacity: 0.4 },
];

export function OceanScene() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {RAYS.map((left, i) => (
        <div key={left} className="tide-ray" style={{ left: `${left}%`, animationDelay: `${-i * 1.7}s` }} />
      ))}

      {BUBBLES.map((b, i) => (
        <span
          key={i}
          className="tide-bubble"
          style={{
            left: `${b.left}%`,
            width: b.size,
            height: b.size,
            animationDuration: `${b.duration}s`,
            animationDelay: `${b.delay}s`,
          }}
        />
      ))}

      {SCHOOL.map((f, i) => (
        <div key={i} className="tide-fish" style={swim(f.top, f.duration, f.delay)}>
          <svg width={f.size} height={f.size / 2} viewBox="0 0 48 24" style={{ opacity: f.opacity }}>
            <path d={FISH} fill="oklch(0.85 0.05 210)" />
          </svg>
        </div>
      ))}

      {/* The "detected" fish: a teal box with a label, like the boxes the app draws on video */}
      <div className="tide-fish" style={swim(64, 15, -4)}>
        <svg width="132" height="78" viewBox="0 0 132 78">
          <path d={FISH} transform="translate(34 38) scale(1.35)" fill="oklch(0.9 0.06 200)" />
          <rect className="tide-box" x="26" y="30" width="80" height="44" rx="4" fill="none"
            stroke="var(--detect)" strokeWidth="2" />
          <g className="tide-fade" style={{ animationDelay: "1.9s" }}>
            <rect x="26" y="10" width="62" height="18" rx="3" fill="var(--detect)" />
            <text x="32" y="23" fontSize="11" fontWeight="600" fill="oklch(0.18 0.04 240)"
              fontFamily="Manrope, sans-serif">fish 0.91</text>
          </g>
        </svg>
      </div>

      <svg className="tide-wave" style={{ animationDuration: "18s", opacity: 0.35 }} viewBox="0 0 2880 120"
        preserveAspectRatio="none" height="110">
        <path d={WAVE} fill="oklch(0.22 0.07 240)" />
      </svg>
      <svg className="tide-wave" style={{ animationDuration: "11s" }} viewBox="0 0 2880 120"
        preserveAspectRatio="none" height="70">
        <path d={WAVE} fill="oklch(0.12 0.04 252)" />
      </svg>
    </div>
  );
}

function swim(top: number, duration: number, delay: number): CSSProperties {
  return { top: `${top}%`, animationDuration: `${duration}s`, animationDelay: `${delay}s` };
}
