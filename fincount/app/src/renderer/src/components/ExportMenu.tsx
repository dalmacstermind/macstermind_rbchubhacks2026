// One "Export" button with a small menu: Excel spreadsheet or PDF.
import { useEffect, useRef, useState } from "react";
import { btnPrimary } from "../ui";

export function ExportMenu({ onExcel, onPdf }: { onExcel: () => void; onPdf: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // While the menu is open, close it on Esc or on a click anywhere outside it.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (action: () => void) => {
    setOpen(false);
    action();
  };
  const item =
    "flex w-full flex-col items-start rounded-lg px-3 py-2 text-left outline-none hover:bg-secondary focus-visible:bg-secondary";

  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(!open)} className={btnPrimary} aria-haspopup="menu" aria-expanded={open}>
        Export <span aria-hidden>▾</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-border bg-card p-1.5 text-sm shadow-lg"
        >
          <button role="menuitem" autoFocus className={item} onClick={() => pick(onExcel)}>
            <span className="font-medium">Excel spreadsheet (.xlsx)</span>
            <span className="text-xs text-muted-foreground">Coastal Action template, points and images</span>
          </button>
          <button role="menuitem" className={item} onClick={() => pick(onPdf)}>
            <span className="font-medium">PDF report</span>
            <span className="text-xs text-muted-foreground">This page, ready to print or share</span>
          </button>
        </div>
      )}
    </div>
  );
}
