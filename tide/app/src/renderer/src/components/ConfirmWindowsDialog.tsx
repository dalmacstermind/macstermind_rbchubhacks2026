// Right after "Count the fish": asks a person to confirm each video's analysis window, one video at a
// time, over the blurred, locked app (like "Who's working?"). Confirming starts that video's count.
// "Decide later" closes it; the unconfirmed windows then wait on the report.
import { useEffect, useState } from "react";
import type { Person, VideoResult } from "../../../shared/api";
import { api } from "../api";
import { Chip, Field, btnGhost, btnPrimary } from "../ui";
import { mmss } from "./WindowConfirm";

function WindowStep({
  video: v,
  position,
  total,
  person,
  onConfirmed,
  onLater,
}: {
  video: VideoResult;
  position: number;
  total: number;
  person: Person;
  onConfirmed: () => void;
  onLater: () => void;
}) {
  const proposed = v.proposedStartS !== null && v.proposedEndS !== null;
  const length = proposed ? v.proposedEndS! - v.proposedStartS! : null;
  const [start, setStart] = useState(v.proposedStartS ?? 0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // The back end checks the protocol rules. If it refuses a time, its reason shows here and the card stays open.
  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (length === null) return;
    setBusy(true);
    setError("");
    try {
      await api.videos.confirmWindow(String(v.id), start, start + length, person.name);
      onConfirmed();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void confirm(e)} className="mt-5 text-left">
      {total > 1 && (
        <div className="mb-2 text-sm font-medium text-primary">
          Video {position} of {total}
        </div>
      )}
      {/* Details on the left, the answer on the right: keeps the card wide and low. */}
      <div className="grid grid-cols-[3fr_2fr] gap-8">
        <div className="min-w-0">
          <div className="break-all font-display text-lg font-semibold">{v.name}</div>
          <div className="text-xs text-muted-foreground">
            {[v.transect, v.stat, v.recordedAt].filter(Boolean).join(" · ") || "Transect, STAT and date not read"}
          </div>
          <p className="mt-3 text-sm">
            <b>Proposed:</b> {proposed ? `${mmss(v.proposedStartS!)}–${mmss(v.proposedEndS!)}` : "none"}.{" "}
            <span className="text-muted-foreground">{v.proposedReason}</span>
          </p>
          {v.shortWindow && (
            <div className="mt-2">
              <Chip tone="review" icon="↔">
                Shorter than the protocol window: not comparable with full windows
              </Chip>
            </div>
          )}
        </div>
        <Field
          label="Start at (seconds)"
          hint={length !== null ? `Ends at ${mmss(start + length)}` : "TIDE couldn't propose a window for this video."}
        >
          <input
            autoFocus
            className="input"
            type="number"
            step={1}
            value={start}
            onChange={(e) => setStart(Number(e.target.value))}
          />
        </Field>
      </div>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className={btnGhost} onClick={onLater}>
          Decide later
        </button>
        <button type="submit" className={btnPrimary} disabled={busy || length === null}>
          Confirm window and count
        </button>
      </div>
    </form>
  );
}

export function ConfirmWindowsDialog({
  surveyId,
  person,
  onFinished,
}: {
  surveyId: number;
  person: Person;
  onFinished: () => void;
}) {
  const [videos, setVideos] = useState<VideoResult[] | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");

  // The list of videos to ask about is read once, so it doesn't shift while they're being confirmed.
  useEffect(() => {
    api.surveys
      .results(surveyId)
      .then((r) => {
        const waiting = r.videos.filter((v) => !v.tooShort && !v.confirmedBy);
        if (waiting.length) setVideos(waiting);
        else onFinished();
      })
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per survey
  }, [surveyId]);

  const video = videos?.[step];
  return (
    // No Esc and no click-outside on purpose: the person chooses Confirm or Decide later.
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-auto bg-background/30 px-6 py-10"
      onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-window-title"
        className="tide-enter w-full max-w-4xl rounded-3xl border border-border bg-card p-8 text-card-foreground shadow-2xl"
      >
        <h2 id="confirm-window-title" className="font-display text-2xl font-semibold">
          Confirm the analysis window
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          No fish are counted in a video until a person confirms this.
        </p>
        {video && (
          <WindowStep
            key={video.id}
            video={video}
            position={step + 1}
            total={videos!.length}
            person={person}
            onConfirmed={() => (step + 1 < videos!.length ? setStep(step + 1) : onFinished())}
            onLater={onFinished}
          />
        )}
        {!video && !error && <p className="mt-5 text-sm text-muted-foreground">Loading…</p>}
        {error && (
          <div className="mt-5">
            <p className="text-sm text-destructive">{error}</p>
            <button className={`${btnGhost} mt-3`} onClick={onFinished}>
              Decide later
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
