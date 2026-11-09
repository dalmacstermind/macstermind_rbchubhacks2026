// Every video that isn't on the Trends graphs, with the reason and the next step, so none disappear silently.
import type { NotPlottedVideo } from "../../../shared/api";
import { Chip, btnLink, plural } from "../ui";
import type { VideoToDate } from "./VideoDateDialog";

export function TrendsNotPlotted({
  videos,
  onOpen,
  onDate,
}: {
  videos: NotPlottedVideo[];
  onOpen: (surveyId: number, videoId: number) => void;
  onDate: (video: VideoToDate) => void;
}) {
  if (!videos.length) return null;
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">Not on the graphs ({plural(videos.length, "video")})</h2>
      <div className="rounded-2xl border border-border bg-card">
        {videos.map((v) => (
          <div
            key={v.videoId}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-2.5 text-sm last:border-0"
          >
            <div className="min-w-0">
              <div className="max-w-xl truncate font-medium" title={v.fileName}>
                {v.fileName}
              </div>
              <div className="text-xs text-muted-foreground">
                {[`Survey ${v.surveyId}: ${v.surveySite}`, v.transect, v.stat, v.recordedAt]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Chip tone="review">{v.explanation}</Chip>
              {v.reason === "no_date" ? (
                <button
                  className={btnLink}
                  onClick={() => onDate({ videoId: v.videoId, fileName: v.fileName, recordedAt: v.recordedAt })}
                >
                  Add date
                </button>
              ) : (
                <button className={btnLink} onClick={() => onOpen(v.surveyId, v.videoId)}>
                  Open video
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
