// The top bar on every screen (CLAUDE.md, App frame): the logo on the left; model mode, keyboard
// shortcuts, light/dark theme, who's working and the offline note on the right.
import type { ModelStatus, Person } from "../../../shared/api";
import type { Theme } from "../theme";
import { Kbd, initials } from "../ui";

// Shared look for the small buttons in the bar, with a visible outline when reached by keyboard.
const barBtn =
  "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

export function AppTopBar({
  busy,
  person,
  switchPerson,
  theme,
  setTheme,
  model,
  onShortcuts,
}: {
  busy: boolean; // a survey is being counted: switching person waits until it finishes
  person: Person;
  switchPerson: () => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  model: ModelStatus | null;
  onShortcuts: () => void;
}) {
  return (
    // overflow-x-auto: if a very narrow window can't fit everything, the bar scrolls instead of wrapping.
    <header className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-sidebar-border bg-sidebar px-6 py-2 text-sidebar-foreground print:hidden">
      <div className="mr-4 flex shrink-0 items-center gap-2.5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-ocean font-display font-bold text-primary-foreground">
          T
        </div>
        <span className="font-display text-lg font-semibold">TIDE</span>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2 pl-4">
        {model?.demo && (
          <span className="rounded-md bg-warning/15 px-2.5 py-1 text-xs text-warning-ink" title={model.message}>
            Demo mode · sample data
          </span>
        )}
        {model && !model.demo && (
          <span
            className="rounded-md bg-sidebar-accent/40 px-2.5 py-1 text-xs"
            title={`${model.message}${model.speciesModel ? ` · ${model.references ?? 0} reference pictures` : " · species model not installed"}`}
          >
            {model.device === "gpu" ? "GPU mode" : "CPU mode (slower)"}
          </span>
        )}
        <button type="button" onClick={onShortcuts} className={barBtn} title="Keyboard shortcuts (press ? anywhere)">
          <Kbd>?</Kbd> Shortcuts
        </button>
        <div
          className="flex rounded-lg border border-sidebar-border p-0.5 text-xs"
          role="radiogroup"
          aria-label="Theme"
        >
          {(["light", "dark"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={theme === t}
              onClick={() => setTheme(t)}
              className={`rounded-md px-2 py-1 outline-none transition focus-visible:ring-2 focus-visible:ring-ring ${
                theme === t ? "bg-card font-medium text-foreground shadow-sm" : "text-sidebar-foreground/70"
              }`}
            >
              {t === "light" ? "☀ Light" : "☾ Dark"}
            </button>
          ))}
        </div>
        <button type="button" onClick={switchPerson} disabled={busy} className={barBtn} title="Switch person">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
            {initials(person.name)}
          </span>
          <span className="max-w-32 truncate font-medium">{person.name}</span>
        </button>
        <span
          className="flex items-center gap-1.5 text-xs text-sidebar-foreground/60"
          title="Offline · nothing leaves this computer"
        >
          <span className="h-2 w-2 rounded-full bg-success" aria-hidden /> Offline
        </span>
      </div>
    </header>
  );
}
