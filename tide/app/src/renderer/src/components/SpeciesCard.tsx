// One species on the Species Registry page: its first reference picture, its names, how many
// pictures it has, and a "New" badge. It's a <button>, so Tab reaches it and Enter or Space opens it.
import type { Species } from "../../../shared/survey";
import { imageCount, isNew, knownScientific } from "../speciesRegistry";

export function SpeciesCard({ sp, onOpen, now }: { sp: Species; onOpen: (sp: Species) => void; now?: Date }) {
  const scientific = knownScientific(sp.scientific);
  return (
    <button
      type="button"
      onClick={() => onOpen(sp)}
      // A low, wide rectangle (8rem tall): the picture on the left, the names on the right.
      className="flex h-32 w-full overflow-hidden rounded-2xl border border-border bg-card text-left outline-none transition hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative h-full w-2/5 shrink-0 bg-secondary/50">
        {sp.thumbnail ? (
          // loading="lazy": the picture is only fetched when the card scrolls into view.
          <img src={sp.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <FishOutline />
        )}
        {isNew(sp.addedAt, now) && (
          <span className="absolute left-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
            New
          </span>
        )}
      </div>
      {/* min-w-0 + line-clamp: long names are cut short with "…" instead of making the card taller. */}
      <div className="flex min-w-0 flex-col justify-center gap-0.5 p-3">
        <div className="line-clamp-2 font-semibold">{sp.common}</div>
        {scientific && <div className="truncate text-sm italic text-muted-foreground">{scientific}</div>}
        <div className="pt-1 text-xs text-muted-foreground">{imageCount(sp.referenceCount)}</div>
      </div>
    </button>
  );
}

/** Neutral placeholder for a species without pictures: a simple fish outline in the muted text colour. */
function FishOutline() {
  return (
    <div className="grid h-full place-items-center text-muted-foreground/50" aria-hidden>
      <svg viewBox="0 0 64 32" className="h-10 w-20" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 16c10-12 30-12 42 0-12 12-32 12-42 0z" />
        <path d="M46 16l12-9v18z" />
        <circle cx="16" cy="14" r="1.5" fill="currentColor" />
      </svg>
    </div>
  );
}
