// The "reef" splash background: everything in OceanScene plus a sea floor with coral and kelp,
// glowing plankton, a jellyfish, and a labelled crab and shrimp. Pure decoration.
import { Crab, Shrimp } from "./Critters";
import { OceanScene } from "./OceanScene";
import { SeaFloor } from "./SeaFloor";
import { SurveyCamera } from "./SurveyCamera";
import "./Reef.css";

// Fixed positions (not random) so the scene looks the same every time.
const PLANKTON = Array.from({ length: 42 }, (_, i) => ({
  left: (i * 53 + 7) % 100,
  top: 28 + ((i * 29) % 66),
  size: 2 + (i % 3),
  drift: 6 + (i % 5),
  twinkle: 1.4 + (i % 4) * 0.6,
  delay: -((i * 0.9) % 6),
}));

const TENTACLES = [12, 22, 32, 42, 52];

export function ReefScene() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <OceanScene />

      {PLANKTON.map((p, i) => (
        <span
          key={i}
          className="reef-plankton"
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            width: p.size,
            height: p.size,
            animationDuration: `${p.drift}s, ${p.twinkle}s`,
            animationDelay: `${p.delay}s, ${p.delay / 2}s`,
          }}
        />
      ))}

      {/* Jellyfish drifting up on the left */}
      <div className="reef-jelly" style={{ left: "11%", top: "56%" }}>
        <svg width="64" height="110" viewBox="0 0 64 110" style={{ opacity: 0.75 }}>
          {TENTACLES.map((x, i) => (
            <path key={x} className="reef-tentacle" style={{ animationDelay: `${-i * 0.4}s` }}
              d={`M${x} 28 q-5 14 0 26 t0 26 t0 22`} fill="none" stroke="oklch(0.85 0.08 300 / 0.5)"
              strokeWidth="1.6" strokeLinecap="round" />
          ))}
          <g className="reef-jelly-bell">
            <path d="M2 30 C2 6 62 6 62 30 C52 26 42 34 32 30 C22 34 12 26 2 30 Z" fill="oklch(0.8 0.09 300 / 0.4)"
              stroke="oklch(0.9 0.07 300 / 0.7)" strokeWidth="1.2" />
            <ellipse cx="32" cy="20" rx="14" ry="7" fill="oklch(0.95 0.06 300 / 0.35)" />
          </g>
        </svg>
      </div>

      <SeaFloor />
      <SurveyCamera />
      <Shrimp />
      <Crab />
    </div>
  );
}
