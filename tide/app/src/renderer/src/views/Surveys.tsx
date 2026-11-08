// Tools → Surveys: every survey on this computer, filtered by All, Pending or Completed.
// "Completed" follows isSurveyComplete (shared/survey.ts): nothing left to count or check.
import { useState } from "react";
import { isSurveyComplete } from "../../../shared/survey";
import { api } from "../api";
import { SurveyRow } from "../components/SurveyRow";
import type { OpenTarget, SurveyOverview } from "../overview";
import { Header, useConfirm } from "../ui";

type Filter = "all" | "pending" | "completed";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "completed", label: "Completed" },
];

const EMPTY: Record<Filter, string> = {
  all: "No surveys yet. Use “Start a new survey” to add footage.",
  pending: "Nothing pending. Every survey is counted and checked.",
  completed: "No completed surveys yet.",
};

export function SurveysView({
  overview,
  onOpen,
  onDeleted,
}: {
  overview: SurveyOverview[] | null;
  onOpen: (surveyId: number, target: OpenTarget) => void;
  onDeleted: (surveyId: number) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmNode, confirm] = useConfirm();
  const all = overview ?? [];
  const completed = all.filter((o) => isSurveyComplete(o.open));
  const pending = all.filter((o) => !isSurveyComplete(o.open));
  const lists: Record<Filter, SurveyOverview[]> = { all, pending, completed };
  const shown = lists[filter];

  return (
    <>
      {confirmNode}
      <Header eyebrow="Tools" title="Surveys" />
      <div className="space-y-4 px-10 py-8">
        <div role="radiogroup" aria-label="Show" className="inline-flex rounded-lg border border-border bg-card p-0.5 text-sm">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="radio"
              aria-checked={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-md px-3 py-1.5 outline-none transition focus-visible:ring-2 focus-visible:ring-ring ${
                filter === f.id ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label} ({lists[f.id].length})
            </button>
          ))}
        </div>

        {overview === null ? (
          <p className="text-sm text-muted-foreground">Loading surveys…</p>
        ) : shown.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
            {EMPTY[filter]}
          </p>
        ) : (
          <div className="rounded-2xl border border-border bg-card">
            {shown.map((o) => (
              <SurveyRow
                key={o.data.survey.id}
                o={o}
                onOpen={onOpen}
                onDelete={() =>
                  confirm(
                    `Delete the survey “${o.data.survey.site}”? Its pictures and checks will be removed from this computer.`,
                    "Delete",
                    () => void api.surveys.remove(o.data.survey.id).then(() => onDeleted(o.data.survey.id)),
                  )
                }
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
