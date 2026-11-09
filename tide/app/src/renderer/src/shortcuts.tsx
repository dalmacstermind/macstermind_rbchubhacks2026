// Keyboard shortcuts. They never fire while typing in a text field, and every action also has a button.
import { useEffect, useRef } from "react";
import { Kbd, Modal, btnPrimary } from "./ui";

export function useKeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true, insideDialog = false) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true]") || e.ctrlKey || e.metaKey || e.altKey) return;
      // A dialog is open. Keys belonging to something inside that dialog still work, unless another opened on top.
      const dialogs = document.querySelectorAll("[role=dialog]").length;
      if (dialogs > (insideDialog ? 1 : 0) && e.key !== "Escape") return;
      const fn = ref.current[e.key] ?? ref.current[e.key.toLowerCase()];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, insideDialog]);
}

const SECTIONS: { title: string; keys: [string[], string][] }[] = [
  {
    title: "Anywhere",
    keys: [
      [["?"], "Show this list"],
      [["Esc"], "Close a box like this one"],
    ],
  },
  {
    title: "Approve Findings",
    keys: [
      [["←", "→"], "Previous / next picture"],
      [["↑", "↓"], "Previous / next box in the picture"],
      [["Y"], "Yes, that's right"],
      [["1", "–", "9"], "Pick a species from the list"],
      [["N"], "Not a fish"],
      [["U"], "Undo my change"],
    ],
  },
  {
    title: "Blind QC",
    keys: [
      [["↑", "↓"], "One more / one fewer fish"],
      [["Enter"], "Submit my count"],
    ],
  },
];

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Keyboard shortcuts"
      onClose={onClose}
      footer={
        <button className={btnPrimary} onClick={onClose}>
          Got it
        </button>
      }
    >
      <div className="space-y-5">
        {SECTIONS.map((s) => (
          <div key={s.title}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{s.title}</div>
            <div className="space-y-1.5">
              {s.keys.map(([keys, what]) => (
                <div key={what} className="flex items-center justify-between gap-4 text-sm">
                  <span>{what}</span>
                  <span className="flex gap-1">
                    {keys.map((k) => (k === "–" ? <span key={k}>–</span> : <Kbd key={k}>{k}</Kbd>))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Shortcuts don't work while you're typing in a box.</p>
      </div>
    </Modal>
  );
}
