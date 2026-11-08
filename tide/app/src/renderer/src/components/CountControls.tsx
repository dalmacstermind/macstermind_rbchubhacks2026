// How a video's point counting is going, with a button to stop it or to count again.
// Shown in the analysis window box (WindowConfirm) once the window is confirmed.
// Stopping keeps nothing of the stopped count; "Count again" counts the same confirmed window from the start.
import { useState } from "react";
import type { Person, VideoResult } from "../../../shared/api";
import { api } from "../api";
import { Chip, btnGhost, useConfirm } from "../ui";

export function CountControls({
  video: v,
  person,
  onChanged,
}: {
  video: VideoResult;
  person: Person;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmNode, confirm] = useConfirm();

  // Calls the back end, then asks the report to load the video again so the new state shows.
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stop = () =>
    confirm(
      `Stop counting ${v.name}? Nothing of this count is kept; you can count it again later.`,
      "Stop counting",
      () => void run(() => api.videos.stopCount(v.id, person.name)),
    );

  const counting = v.countState === "queued" || v.countState === "running";
  const canCountAgain = v.countState === "stopped" || v.countState === "failed";
  return (
    <>
      {confirmNode}
      {counting && <Chip tone="working">{v.countDetail || "Counting…"}</Chip>}
      {v.countState === "failed" && <Chip tone="failed">{v.countDetail}</Chip>}
      {v.countState === "done" && v.countDetail && <Chip tone="done">{v.countDetail}</Chip>}
      {v.countState === "stopped" && (
        <Chip tone="skipped" icon="■">
          {v.countDetail || "Counting stopped"}
        </Chip>
      )}
      {counting && (
        <button className={`${btnGhost} py-1`} disabled={busy} onClick={stop}>
          Stop counting
        </button>
      )}
      {canCountAgain && (
        <button
          className={`${btnGhost} py-1`}
          disabled={busy}
          onClick={() => void run(() => api.videos.startCount(v.id, person.name))}
        >
          Count again
        </button>
      )}
      {error && <span className="text-destructive">{error}</span>}
    </>
  );
}
