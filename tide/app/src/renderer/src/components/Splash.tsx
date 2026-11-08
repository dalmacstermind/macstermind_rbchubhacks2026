// Start-up splash: the TIDE wordmark rising out of an underwater scene while the back end starts.
// It plays during time staff already spend waiting, then hands over to "Who's working?".
import { useEffect, useState } from "react";
import { OceanScene } from "./OceanScene";
import { ReefScene } from "./ReefScene";
import "./Splash.css";

const LETTERS = ["T", "I", "D", "E"];
// The full name, shown word by word; `initial` marks the words that spell T-I-D-E.
const FULL_NAME = [
  { word: "Tracking", initial: true },
  { word: "&", initial: false },
  { word: "Identification", initial: true },
  { word: "for", initial: false },
  { word: "Deep-sea", initial: true },
  { word: "Ecosystems", initial: true },
];
// Two looks: "classic" and "reef" (in use: adds a labelled crab and shrimp, coral, plankton, a camera).
export type SplashVariant = "classic" | "reef";
// How long each look stays before it may leave (a click or any key skips).
const PLAY_MS: Record<SplashVariant, number> = { classic: 13000, reef: 15000 };
const LEAVE_MS = 650; // matches the fade-out in Splash.css

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * `ready` turns true when the back end answers. The splash leaves once it is ready AND the
 * animation has played (or the user clicked / pressed a key to skip), then calls `onDone`.
 */
export function Splash({ ready, onDone, variant = "classic" }: { ready: boolean; onDone: () => void; variant?: SplashVariant }) {
  const [still] = useState(reducedMotion);
  const [played, setPlayed] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Let the animation finish once. A click or any key skips it (still waits for the back end).
  useEffect(() => {
    const skip = () => setPlayed(true);
    const timer = setTimeout(skip, still ? 300 : PLAY_MS[variant]);
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [still, variant]);

  // Both conditions met: start the fade-out.
  useEffect(() => {
    if (ready && played) setLeaving(true);
  }, [ready, played]);

  // After the fade-out, show the app. Kept separate so re-renders can't cancel the timer.
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(onDone, still ? 0 : LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving, still, onDone]);

  return (
    <div className={`tide-splash ${leaving ? "is-leaving" : ""}`}>
      {variant === "reef" ? <ReefScene /> : <OceanScene />}

      <div className="relative grid h-full place-items-center px-8 text-center">
        <div>
          <h1 aria-label="TIDE" className="pb-2 font-display text-[clamp(4.5rem,14vw,10rem)] font-bold leading-none tracking-[0.18em]">
            {LETTERS.map((l, i) => (
              <span key={l} aria-hidden="true" className="tide-letter" style={{ animationDelay: `${300 + i * 110}ms` }}>
                {l}
              </span>
            ))}
          </h1>

          <svg aria-hidden="true" className="mx-auto -mt-1 block" width="300" height="24" viewBox="0 0 300 24">
            <path className="tide-underline" d="M4 12 Q41 2 78 12 T152 12 T226 12 T296 12" fill="none"
              stroke="var(--detect)" strokeWidth="3" strokeLinecap="round" />
          </svg>

          {/* Full name: words surface one after another; the T, I, D and E are highlighted */}
          <p className="mt-5 font-display text-[clamp(1.1rem,2.2vw,1.6rem)] font-medium tracking-wide">
            {FULL_NAME.map(({ word, initial }, i) => (
              <span key={word} className="tide-fade inline-block" style={{ animationDelay: `${1.9 + i * 0.22}s` }}>
                {initial ? (
                  <>
                    <span className="font-bold text-[var(--detect)]">{word[0]}</span>
                    {word.slice(1)}
                  </>
                ) : (
                  <span className="opacity-70">{word}</span>
                )}
                {i < FULL_NAME.length - 1 && " "}
              </span>
            ))}
          </p>

          <p className="tide-fade mt-8 font-sans text-lg opacity-90" style={{ animationDelay: "3.6s" }}>
            Fish counts from underwater video, right on this computer.
          </p>
          <p className="tide-fade mt-2 font-sans text-xs uppercase tracking-[0.3em] opacity-60" style={{ animationDelay: "3.9s" }}>
            For Coastal Action · Nova Scotia
          </p>
        </div>
      </div>

      {/* In the reef look the crab walks along the bottom, so the status sits at the top instead */}
      <div role="status" aria-live="polite"
        className={`absolute inset-x-0 ${variant === "reef" ? "top-8" : "bottom-24"} flex items-center justify-center gap-3 font-sans text-sm`}>
        <span className="relative grid h-2.5 w-2.5 place-items-center">
          {!ready && <span className="tide-ping absolute h-2.5 w-2.5 rounded-full bg-[var(--detect)]" />}
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--detect)]" />
        </span>
        <span className="opacity-85">{ready ? "Ready" : "Starting TIDE…"}</span>
      </div>
    </div>
  );
}
