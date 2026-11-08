// The analysis window TIDE proposed for a video (US-2.1), for a person to confirm or change.
// Nothing is counted until it's confirmed; confirming starts the point counting in the back end.
// The back end checks the protocol rules and explains in plain English if a time isn't allowed.
import { useState } from "react";
import type { Person, VideoResult } from "../../../shared/api";
import { api } from "../api";
import { Chip, btnPrimary } from "../ui";
import { CountControls } from "./CountControls";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function WindowConfirm({
  video: v,
  person,
  onChanged,
}: {
  video: VideoResult;
  person: Person;
  onChanged: () => void;
}) {
  const length = v.proposedStartS !== null && v.proposedEndS !== null ? v.proposedEndS - v.proposedStartS : null;
  const [start, setStart] = useState(v.windowStartS ?? v.proposedStartS ?? 0);
  const [error, setError] = useState("");

  if (v.tooShort)
    return (
      <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-ink">
        ⚠ {v.proposedReason || "Too short for the protocol: this video isn't processed."}
      </p>
    );

  const confirm = async () => {
    if (length === null) return;
    setError("");
    try {
      await api.videos.confirmWindow(String(v.id), start, start + length, person.name);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const changed = v.windowStartS !== null && start !== v.windowStartS;
  return (
    <div className="mt-3 rounded-xl border border-border bg-secondary/30 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">Analysis window</span>
        {v.confirmedBy ? (
          <Chip tone="done">
            {mmss(v.windowStartS ?? 0)}–{mmss(v.windowEndS ?? 0)} confirmed by {v.confirmedBy}
          </Chip>
        ) : (
          <Chip tone="review">Not confirmed: nothing is counted yet</Chip>
        )}
        {v.shortWindow && (
          <Chip tone="review" icon="↔">
            Shorter than the protocol window: not comparable with full windows
          </Chip>
        )}
        {v.confirmedBy && <CountControls video={v} person={person} onChanged={onChanged} />}
      </div>
      <p className="mt-2 text-muted-foreground">
        Proposed{" "}
        {v.proposedStartS !== null && v.proposedEndS !== null
          ? `${mmss(v.proposedStartS)}–${mmss(v.proposedEndS)}`
          : "–"}
        . {v.proposedReason}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          Start at (seconds)
          <input
            className="input w-28 py-1"
            type="number"
            step={1}
            value={start}
            onChange={(e) => setStart(Number(e.target.value))}
          />
        </label>
        {length !== null && <span className="text-muted-foreground">ends at {mmss(start + length)}</span>}
        {(!v.confirmedBy || changed) && (
          <button className={btnPrimary} onClick={() => void confirm()}>
            {v.confirmedBy ? "Confirm the new window (counts again)" : "Confirm window and count"}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-destructive">{error}</p>}
    </div>
  );
}
