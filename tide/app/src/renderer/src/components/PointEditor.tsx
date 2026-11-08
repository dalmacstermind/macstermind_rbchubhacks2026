// Review one subsample point: watch its context clip, then confirm or correct the count and visibility.
// The AI's own numbers are kept by the back end next to the person's.
import { useState } from "react";
import type { Person, PointResult } from "../../../shared/api";
import { api } from "../api";
import { Field, Modal, btnGhost, btnLink, btnPrimary } from "../ui";

export function PointEditor({
  point: p,
  categories,
  person,
  onClose,
  onSaved,
}: {
  point: PointResult;
  categories: string[];
  person: Person;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fish, setFish] = useState(p.totalFish);
  const [inv, setInv] = useState(p.invertebrates);
  const [visibility, setVisibility] = useState(p.visibility ?? p.suggestedVisibility ?? "");
  const [notes, setNotes] = useState(p.staffNotes);
  const [error, setError] = useState("");

  const save = async (patch: Parameters<typeof api.points.update>[1]) => {
    try {
      await api.points.update(p.id, patch);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal
      title={`Point ${p.pointNo}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button
            className={btnPrimary}
            onClick={() => void save({ totalFish: fish, invertebrates: inv, visibility, notes, by: person.name })}
          >
            Save review
          </button>
        </>
      }
    >
      {p.clip ? (
        // The ±context clip around the point (the count only uses ±tolerance around the point itself).
        <video src={p.clip} controls className="w-full rounded-xl bg-black" />
      ) : (
        <p className="text-sm text-muted-foreground">No context clip was saved for this point.</p>
      )}
      <p className="mt-3 text-sm text-muted-foreground">
        The AI counted <b className="text-foreground">{p.ai.totalFish}</b> fish and{" "}
        <b className="text-foreground">{p.ai.invertebrates}</b> invertebrates at this point.
        {p.notes && ` ${p.notes}.`}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field label="Fish at this point">
          <input
            className="input"
            type="number"
            min={0}
            value={fish}
            onChange={(e) => setFish(Number(e.target.value))}
          />
        </Field>
        <Field label="Invertebrates">
          <input className="input" type="number" min={0} value={inv} onChange={(e) => setInv(Number(e.target.value))} />
        </Field>
        <Field label="Visibility (confirmed)" hint={p.suggestedVisibility ? `Suggested: ${p.suggestedVisibility}` : ""}>
          <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
            <option value="">Not confirmed</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      {p.reviewed && (
        <button
          className={`${btnLink} mt-3`}
          onClick={() => void save({ totalFish: -1, invertebrates: -1, by: person.name })}
        >
          Use the AI's counts again
        </button>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </Modal>
  );
}
