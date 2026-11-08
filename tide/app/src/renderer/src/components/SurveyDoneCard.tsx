// Shown on the report once nothing is left to check: the clear way out to the next survey.
import { btnGhost, btnPrimary } from "../ui";

export function SurveyDoneCard({ exported, onNewSurvey }: { exported: boolean; onNewSurvey: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-success/40 bg-success/10 px-6 py-4 print:hidden">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-success text-sm font-bold text-success-foreground" aria-hidden>
          ✓
        </span>
        <div>
          <div className="font-semibold">This survey is finished</div>
          <div className="text-sm text-muted-foreground">
            {exported
              ? "Everything is checked and exported. You can start the next survey."
              : "Everything is checked. Export it, then start the next survey."}{" "}
            This one stays saved under “Your surveys”.
          </div>
        </div>
      </div>
      <button onClick={onNewSurvey} className={exported ? btnPrimary : btnGhost}>
        Start a new survey →
      </button>
    </div>
  );
}
