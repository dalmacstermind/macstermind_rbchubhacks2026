/** Counting progress for one video (or a whole survey): a ring with the percentage, what it's doing,
 * about how long is left, and a bar. Shown while a confirmed video is waiting or being counted. */

export function timeLeft(etaS: number | null | undefined): string {
  if (etaS === null || etaS === undefined) return "Working out how long this takes…";
  if (etaS < 10) return "Almost done";
  if (etaS < 60) return `About ${Math.ceil(etaS / 10) * 10} seconds left`;
  const min = Math.round(etaS / 60);
  return `About ${min} minute${min === 1 ? "" : "s"} left`;
}

/** The stage from the back end's status text, without the percentage and time left the ring shows:
 * "Identifying the species: 93% · less than a minute left" -> "Identifying the species". */
export function stageOf(detail: string): string {
  return detail.replace(/:\s*\d+%.*$/, "").trim();
}

export function ProgressRing({
  percent,
  size = 72,
  waiting = false,
}: {
  percent: number;
  size?: number;
  waiting?: boolean;
}) {
  const stroke = Math.max(5, size / 12);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={waiting ? "animate-spin" : ""}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--secondary)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          // Waiting: a short arc that spins. Counting: the arc fills clockwise from the top.
          strokeDashoffset={waiting ? c * 0.75 : c * (1 - pct / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      {!waiting && (
        <div
          className="absolute inset-0 grid place-items-center font-display font-semibold"
          style={{ fontSize: size / 4.2 }}
        >
          {Math.floor(pct)}%
        </div>
      )}
    </div>
  );
}

export function CountProgress({
  state,
  percent,
  detail,
  etaS,
  title = "Counting the points",
  size = 72,
}: {
  state: "queued" | "running";
  percent: number | null;
  detail: string;
  etaS: number | null;
  title?: string;
  size?: number;
}) {
  const waiting = state === "queued";
  const pct = percent ?? 0;
  return (
    <div className="flex items-center gap-4" aria-live="polite">
      <ProgressRing percent={pct} size={size} waiting={waiting} />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{waiting ? "Waiting to count" : title}</div>
        <div className="text-sm text-muted-foreground">
          {waiting
            ? detail || "It starts as soon as the video before it is done."
            : `${stageOf(detail) || "Working"} · ${timeLeft(etaS)}`}
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-label={title}
          aria-valuenow={waiting ? undefined : Math.floor(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full bg-gradient-ocean transition-all duration-500 ${waiting ? "w-1/4 animate-pulse" : ""}`}
            style={waiting ? undefined : { width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
