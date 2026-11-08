// The label chooser on the Label page: what's being labelled, the picker, and the reference picture option.
import type { ComponentProps } from "react";
import { btnGhost } from "../ui";
import { LabelPicker } from "./LabelPicker";

export function LabelPanel({
  title,
  asReference,
  onAsReference,
  onUndo,
  message,
  ...picker
}: {
  title: string;
  asReference: boolean;
  onAsReference: (value: boolean) => void;
  onUndo?: () => void; // shown when this fish already has a label
  message: string;
} & ComponentProps<typeof LabelPicker>) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-2 font-display font-semibold">{title}</div>
      <LabelPicker {...picker} />
      <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={asReference} onChange={(e) => onAsReference(e.target.checked)} />
        Use as reference picture (not for test videos used to measure the AI)
      </label>
      {onUndo && (
        <button className={`${btnGhost} mt-3`} onClick={onUndo}>
          Undo this label
        </button>
      )}
      {message && <p className="mt-3 text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
