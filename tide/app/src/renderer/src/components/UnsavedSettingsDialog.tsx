// Shown when someone leaves Settings with changes that aren't saved: save them, drop them, or stay.
import type { Change } from "../protocolSettings";
import { Modal, btnGhost, btnPrimary } from "../ui";

export function UnsavedSettingsDialog({
  changes,
  person,
  blocked,
  error,
  saving,
  onSave,
  onDiscard,
  onClose,
}: {
  changes: Change[];
  person: string;
  blocked: boolean; // a value breaks a protocol rule, so it can't be saved yet
  error: string;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Save your changes?"
      onClose={onClose}
      footer={
        <>
          <button className={btnGhost} disabled={saving} onClick={onClose}>
            Keep editing
          </button>
          <button className={btnGhost} disabled={saving} onClick={onDiscard}>
            Don't save
          </button>
          <button className={btnPrimary} disabled={saving || blocked} onClick={onSave}>
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <ul className="space-y-1.5 text-sm">
        {changes.map((c) => (
          <li key={c.label} className="flex justify-between gap-6">
            <span>{c.label}</span>
            <span>
              <span className="text-muted-foreground line-through">{c.from}</span> → <b>{c.to}</b>
            </span>
          </li>
        ))}
      </ul>
      {blocked && <p className="mt-4 text-sm text-destructive">Fix the values marked in red before saving.</p>}
      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      <p className="mt-4 text-xs text-muted-foreground">
        Protocol changes apply to surveys processed from now on and are saved with your name ({person}).
      </p>
    </Modal>
  );
}
