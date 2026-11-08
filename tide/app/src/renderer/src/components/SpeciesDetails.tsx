// The "Details" part of the species dialog: group, habitat, status (a human note, never set by the
// AI), who added it, and "Remove species" for species staff added. These were table columns before.
import { STATUS_LABEL, UNKNOWN, type Species, type SpeciesStatus } from "../../../shared/survey";

export function SpeciesDetails({
  sp,
  onStatus,
  onRemove,
}: {
  sp: Species;
  onStatus: (status: SpeciesStatus) => void;
  onRemove: () => void; // asks "Are you sure?" first (in the parent)
}) {
  return (
    <section aria-label="Details" className="rounded-xl border border-border p-4 text-sm">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Details</div>
      <dl className="grid grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-2">
        <dt className="text-muted-foreground">Group</dt>
        <dd>{sp.kind === "invertebrate" ? "Invertebrate" : "Fish"}</dd>
        <dt className="text-muted-foreground">Habitat</dt>
        <dd>{sp.habitat}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd>
          {sp.id === UNKNOWN ? (
            <span className="text-muted-foreground">Used when the species can't be told</span>
          ) : (
            <select
              value={sp.status}
              aria-label={`Status of ${sp.common}`}
              className="input w-auto py-1"
              onChange={(e) => onStatus(e.target.value as SpeciesStatus)}
            >
              {(Object.keys(STATUS_LABEL) as SpeciesStatus[]).map((k) => (
                <option key={k} value={k}>
                  {STATUS_LABEL[k]}
                </option>
              ))}
            </select>
          )}
        </dd>
        <dt className="text-muted-foreground">Added by</dt>
        <dd>
          {sp.custom
            ? `${sp.addedBy || "Someone"}${sp.addedAt ? ` · ${sp.addedAt.slice(0, 10)}` : ""}`
            : "Came with the app"}
        </dd>
      </dl>
      {sp.custom && (
        <button type="button" className="mt-3 text-sm text-muted-foreground hover:text-destructive" onClick={onRemove}>
          Remove species
        </button>
      )}
    </section>
  );
}
