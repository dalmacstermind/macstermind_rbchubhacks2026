// One reference picture shown large inside the species dialog, with where it came from and who
// added it. "Remove image" asks "Are you sure?" first (handled by the parent dialog).
import type { Reference } from "../../../shared/api";
import { describeSource } from "../speciesRegistry";
import { btnGhost } from "../ui";

export function ReferenceImageView({
  r,
  common,
  busy,
  onBack,
  onRemove,
}: {
  r: Reference;
  common: string;
  busy: boolean;
  onBack: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-3">
      <img
        src={r.image}
        alt={`Reference image of ${common}`}
        className="max-h-[50vh] w-full rounded-xl bg-secondary/40 object-contain"
      />
      <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">From</dt>
        <dd>{describeSource(r)}</dd>
        <dt className="text-muted-foreground">Picture added by</dt>
        <dd>
          {r.addedBy || "Not recorded"}
          {r.addedAt && ` · ${r.addedAt}`}
        </dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnGhost} onClick={onBack}>
          ← All images
        </button>
        <button
          type="button"
          className={`${btnGhost} text-destructive hover:bg-destructive/10`}
          onClick={onRemove}
          disabled={busy}
        >
          Remove image
        </button>
      </div>
    </div>
  );
}
