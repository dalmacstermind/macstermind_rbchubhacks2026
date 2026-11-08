// "Match species again": after reference pictures change, the back end compares this survey's fish
// with the new pictures (no new detection). Fish a person already checked keep their species.
import { useState } from "react";
import { api } from "../api";
import { btnGhost, plural } from "../ui";

export function MatchAgainButton({ surveyId, onDone }: { surveyId: number; onDone: () => void }) {
  const [state, setState] = useState<{ busy: boolean; message: string }>({ busy: false, message: "" });

  const run = async () => {
    setState({ busy: true, message: "" });
    try {
      const r = await api.surveys.reidentify(surveyId);
      setState({ busy: false, message: `${plural(r.changed, "box", "boxes")} updated` });
      onDone();
    } catch (e) {
      setState({ busy: false, message: (e as Error).message });
    }
  };

  return (
    <span className="flex items-center gap-2">
      {state.message && <span className="max-w-xs text-xs text-muted-foreground">{state.message}</span>}
      <button
        onClick={() => void run()}
        disabled={state.busy}
        className={btnGhost}
        title="Compare this survey's fish with the species' current reference pictures"
      >
        {state.busy ? "Matching…" : "Match species again"}
      </button>
    </span>
  );
}
