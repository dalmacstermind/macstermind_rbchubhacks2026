// Shown before protocol settings are saved: exactly what changes, and that it applies to new
// processing only. Nothing is saved until "Save for new surveys" is clicked.
import { Modal, btnGhost, btnPrimary } from "../ui";
import type { Change } from "../protocolSettings";

export function ProtocolChangeSummary({
  changes,
  person,
  onConfirm,
  onClose,
}: {
  changes: Change[];
  person: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Change the protocol settings?"
      onClose={onClose}
      footer={
        <>
          <button className={btnGhost} onClick={onClose}>
            Back
          </button>
          <button className={btnPrimary} onClick={onConfirm}>
            Save for new surveys
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
      <p className="mt-4 text-xs text-muted-foreground">
        These apply to surveys processed from now on. Surveys already processed keep the values they were processed
        with. The change is saved with your name ({person}).
      </p>
    </Modal>
  );
}
