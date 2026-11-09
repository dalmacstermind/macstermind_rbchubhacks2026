// The four survey steps as one row of tabs, directly below the top bar (CLAUDE.md, App frame).
// Each tab is a normal button, so Tab moves between them and Enter opens one. Tabs that can't be
// used yet are disabled, and the keyboard skips them. Starting a new survey is the button at the top
// of the Tools column (ToolsSidebar), not a step.
import type { Page } from "../pages";

type Step = { id: Page; label: string; enabled: boolean; badge?: number };

export function StepTabs({
  page,
  go,
  busy,
  hasSurvey,
  toCheck,
}: {
  page: Page;
  go: (p: Page) => void;
  busy: boolean; // a survey is being counted: the other steps are locked until it finishes
  hasSurvey: boolean; // a survey is open, so Counting, Approve Findings and Label Unknown Fish can be used
  toCheck: number; // fish waiting to be checked or named (badge on "Approve Findings")
}) {
  const steps: Step[] = [
    { id: "processing", label: "Processing", enabled: false }, // a progress step, never clicked
    { id: "report", label: "Counting", enabled: hasSurvey && !busy },
    { id: "review", label: "Approve Findings", enabled: hasSurvey && !busy, badge: toCheck },
    { id: "label", label: "Label Unknown Fish", enabled: hasSurvey && !busy },
  ];
  return (
    // overflow-x-auto: on narrow windows the row scrolls sideways instead of wrapping onto two lines.
    <nav
      aria-label="Survey steps"
      className="flex shrink-0 overflow-x-auto border-b border-border bg-card px-6 print:hidden"
    >
      {steps.map((s, i) => {
        const current = page === s.id;
        return (
          <button
            key={s.id}
            type="button"
            disabled={!s.enabled}
            onClick={() => go(s.id)}
            aria-current={current ? "page" : undefined}
            // The current tab gets a thick underline AND bold text, so it doesn't depend on colour.
            // ring-inset keeps the focus outline inside the button, where the scrolling row can't cut it off.
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap border-b-[3px] px-4 py-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 ${
              current
                ? "border-primary font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <span
              aria-hidden
              className={`grid h-5 w-5 place-items-center rounded-full border text-[11px] ${
                current ? "border-primary bg-primary text-primary-foreground" : "border-border"
              }`}
            >
              {i + 1}
            </span>
            {s.label}
            {!!s.badge && (
              <span
                className="rounded-full bg-warning px-2 text-xs font-semibold text-warning-foreground"
                title={`${s.badge} to check`}
              >
                {s.badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
