// Shown on the report instead of counts when no video of the survey has been counted:
// an empty report here means "not looked at yet", never "no fish".
import type { SurveyInfo } from "../../../shared/api";

export function NotCountedYet({ survey }: { survey: SurveyInfo }) {
  const next = survey.windowsToConfirm
    ? "Confirm the analysis window above to start counting."
    : survey.videosCounting
      ? "Counting is under way. The numbers appear here when it finishes."
      : "Counting didn't finish. Use Count again above to start over.";
  return (
    <div className="rounded-2xl border border-border bg-card p-10 text-center">
      <div className="font-display text-lg font-semibold">Not counted yet</div>
      <p className="mt-1 text-sm text-muted-foreground">TIDE hasn't looked for fish in this survey's videos. {next}</p>
    </div>
  );
}
