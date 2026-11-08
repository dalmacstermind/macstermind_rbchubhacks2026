// Sea floor for the "reef" splash: sand, rocks, swaying kelp and a few kinds of coral.
// Drawn in a 1440 × 300 box anchored to the bottom of the screen. Pure decoration.

const KELP = [
  { x: 96, h: 230, d: 5.2, c: "oklch(0.42 0.09 150 / 0.75)" },
  { x: 132, h: 180, d: 6.1, c: "oklch(0.36 0.08 155 / 0.7)" },
];

// A wavy kelp strand rising `h` px from the floor at `x`.
const kelp = (x: number, h: number) =>
  `M${x} 300 C${x - 22} ${300 - h * 0.3} ${x + 22} ${300 - h * 0.55} ${x - 4} ${300 - h * 0.75} ` +
  `S${x + 10} ${300 - h * 0.95} ${x + 2} ${300 - h}`;

export function SeaFloor() {
  return (
    <svg aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[34vh] w-full" viewBox="0 0 1440 300"
      preserveAspectRatio="xMidYMax slice">
      {KELP.map((k) => (
        <g key={k.x} className="reef-sway" style={{ animationDuration: `${k.d}s` }}>
          <path d={kelp(k.x, k.h)} fill="none" stroke={k.c} strokeWidth="9" strokeLinecap="round" />
          <ellipse cx={k.x + 12} cy={300 - k.h * 0.5} rx="12" ry="5" fill={k.c} transform={`rotate(-30 ${k.x + 12} ${300 - k.h * 0.5})`} />
          <ellipse cx={k.x - 12} cy={300 - k.h * 0.78} rx="11" ry="4" fill={k.c} transform={`rotate(30 ${k.x - 12} ${300 - k.h * 0.78})`} />
        </g>
      ))}

      {/* Branching coral */}
      <g className="reef-sway" style={{ animationDuration: "7s" }} fill="none" stroke="oklch(0.62 0.14 30 / 0.85)"
        strokeWidth="9" strokeLinecap="round">
        <path d="M300 292 L300 228 M300 250 L268 212 L260 182 M268 212 L286 186 M300 236 L332 202 L326 172 M332 202 L352 184 M300 228 L302 190" />
      </g>
      <g className="reef-sway" style={{ animationDuration: "8s" }} fill="none" stroke="oklch(0.66 0.12 55 / 0.8)"
        strokeWidth="7" strokeLinecap="round">
        <path d="M1196 292 L1196 240 L1176 214 L1172 192 M1196 250 L1220 222 L1230 200 M1220 222 L1214 204" />
      </g>

      {/* Brain coral */}
      <path d="M470 292 Q520 226 570 292 Z" fill="oklch(0.58 0.09 85 / 0.75)" />
      <path d="M486 286 q8 -14 16 -2 t16 -2 t16 -2 t16 2 M496 270 q8 -10 16 0 t16 0 t14 2" fill="none"
        stroke="oklch(0.42 0.07 80 / 0.8)" strokeWidth="2.5" strokeLinecap="round" />

      {/* Fan coral */}
      <g className="reef-sway" style={{ animationDuration: "9s" }}>
        <path d="M1060 292 C1010 250 1004 196 1040 176 C1060 166 1086 170 1100 182 C1128 210 1110 260 1060 292 Z"
          fill="oklch(0.52 0.13 330 / 0.55)" />
        <path d="M1060 292 L1036 190 M1060 292 L1062 176 M1060 292 L1088 184 M1060 292 L1108 214 M1060 292 L1020 222"
          stroke="oklch(0.7 0.12 330 / 0.6)" strokeWidth="2" fill="none" />
      </g>

      {/* Sea anemone */}
      <g fill="none" stroke="oklch(0.72 0.12 350 / 0.8)" strokeWidth="5" strokeLinecap="round">
        {[-36, -20, -6, 8, 22, 36].map((a, i) => (
          <path key={a} className="reef-sway" style={{ animationDuration: `${2.6 + i * 0.3}s` }}
            d={`M880 288 q${a * 0.4} -24 ${a} -40`} />
        ))}
      </g>
      <ellipse cx="880" cy="290" rx="18" ry="8" fill="oklch(0.5 0.1 350 / 0.8)" />

      {/* Rocks and sand */}
      <ellipse cx="640" cy="292" rx="46" ry="16" fill="oklch(0.22 0.03 240)" />
      <ellipse cx="200" cy="294" rx="30" ry="10" fill="oklch(0.2 0.03 240)" />
      <path d="M0 300 V284 Q180 270 360 284 T720 282 T1080 286 T1440 280 V300 Z" fill="oklch(0.24 0.04 70 / 0.9)" />
    </svg>
  );
}
