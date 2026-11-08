// The narrow column on the left with the Tools (CLAUDE.md, App frame): Blind QC, Trends,
// Species list and Settings. The survey steps are the row of tabs above the page (StepTabs).
import type { Page } from "../pages";

const TOOLS: { id: Page; label: string; icon: string }[] = [
  { id: "qc", label: "Blind QC", icon: "✓" },
  { id: "trends", label: "Trends", icon: "↗" },
  { id: "species", label: "Species list", icon: "≡" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

export function ToolsSidebar({
  page,
  go,
  busy,
}: {
  page: Page;
  go: (p: Page) => void;
  busy: boolean; // a survey is being counted: the tools wait until it finishes
}) {
  return (
    <aside className="w-52 shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar px-3 py-4 text-sidebar-foreground print:hidden">
      <nav aria-label="Tools">
        <div className="mx-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
          Tools
        </div>
        {TOOLS.map((t) => {
          const current = page === t.id;
          return (
            <button
              key={t.id}
              type="button"
              disabled={busy}
              onClick={() => go(t.id)}
              aria-current={current ? "page" : undefined}
              // The current tool has a coloured bar on its left AND bold text, so it doesn't depend on
              // colour alone (like the underline on the step tabs).
              className={`flex w-full items-center gap-3 rounded-lg border-l-[3px] px-3 py-2 text-left text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${
                current
                  ? "border-sidebar-primary bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                  : "border-transparent text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
              }`}
            >
              <span aria-hidden className="grid h-5 w-5 place-items-center text-sidebar-primary">
                {t.icon}
              </span>
              {t.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
