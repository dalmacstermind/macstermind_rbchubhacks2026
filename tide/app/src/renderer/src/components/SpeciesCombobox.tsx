// A combo box: type to filter the list, then pick. Labels are CHOSEN, never typed (CLAUDE.md): what
// you type only filters; the result is always one of the listed options. If nothing matches, it
// offers "Add <name> as a new species…" (which opens the confirmation form). No extra library.
import { useMemo, useRef, useState } from "react";

export type ComboOption = { value: string; label: string; group: string; hint?: string };

export function SpeciesCombobox({
  options,
  onChoose,
  onAddNew,
  placeholder = "Type to search, then pick…",
  disabled,
}: {
  options: ComboOption[];
  onChoose: (value: string) => void;
  onAddNew?: (typed: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  // Options whose name (or scientific name) contains what was typed, keeping their groups in order.
  const shown = useMemo(() => {
    const q = text.trim().toLowerCase();
    return q ? options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q)) : options;
  }, [options, text]);

  const pick = (o: ComboOption) => {
    onChoose(o.value);
    setText("");
    setOpen(false);
    setActive(0);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(shown.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[active]) pick(shown[active]);
      else if (text.trim() && onAddNew) onAddNew(text.trim());
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  let lastGroup = "";
  return (
    <div className="relative">
      <input
        ref={input}
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-label="Search and choose a label"
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey}
      />
      {open && !disabled && (
        <div
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-border bg-card p-1 shadow-xl"
        >
          {shown.map((o, i) => {
            const header = o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <div key={o.value}>
                {header && (
                  <div className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {header}
                  </div>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(o)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
                    i === active ? "bg-secondary" : ""
                  }`}
                >
                  <span>{o.label}</span>
                  {o.hint && <span className="truncate text-xs italic text-muted-foreground">{o.hint}</span>}
                </button>
              </div>
            );
          })}
          {!shown.length && (
            <div className="px-2 py-2 text-sm text-muted-foreground">
              No label called “{text.trim()}”.
              {onAddNew && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onAddNew(text.trim())}
                  className="ml-1 text-primary hover:underline"
                >
                  Add “{text.trim()}” as a new species…
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
