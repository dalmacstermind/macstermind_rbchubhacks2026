// "Use as reference picture": saves a checked fish's crop as a reference picture of its species,
// so the species model recognises it better next time (no retraining).
// Don't use it on test videos that are being used to measure the AI (CLAUDE.md, "No data leakage").
import { useState } from "react";
import type { Person } from "../../../shared/api";
import { NOT_FISH, UNKNOWN, type Detection, type Species } from "../../../shared/survey";
import { api } from "../api";
import { btnLink } from "../ui";

export function UseAsReference({
  det,
  species,
  person,
  onAdded,
}: {
  det: Detection;
  species: Species[];
  person: Person;
  onAdded: () => void;
}) {
  // Reset the message when another box is selected.
  const [state, setState] = useState<{ id: string; message: string }>({ id: "", message: "" });
  const message = state.id === det.id ? state.message : "";
  const sp = species.find((s) => s.id === det.speciesId);
  if (!det.verified || !sp || det.speciesId === UNKNOWN || det.speciesId === NOT_FISH) return null;

  const add = async () => {
    try {
      await api.species.references.fromDetection(sp.id, det.id, person.name);
      setState({ id: det.id, message: `Added as a reference picture of ${sp.common}.` });
      onAdded();
    } catch (e) {
      setState({ id: det.id, message: (e as Error).message });
    }
  };

  return (
    <div className="mt-3 text-xs">
      {message ? (
        <span className="text-muted-foreground">{message}</span>
      ) : (
        <button className={btnLink} onClick={() => void add()} title="Not for test videos used to measure the AI">
          Use as reference picture of {sp.common}
        </button>
      )}
    </div>
  );
}
