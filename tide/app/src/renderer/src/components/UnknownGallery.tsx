// One card per tracked fish the AI couldn't name (not one per picture). Tick cards to label several
// at once; click a card to look at it closely.
import type { UnknownFish } from "../../../shared/api";
import type { Species } from "../../../shared/survey";
import { Chip } from "../ui";

export function labelText(f: UnknownFish, species: Species[]): string {
  const l = f.label;
  if (!l) return "";
  if (l.action === "species") return species.find((s) => s.id === l.species)?.common ?? l.species ?? "";
  if (l.action === "invertebrate") return `Invertebrate${l.invertebrateType ? `: ${l.invertebrateType}` : ""}`;
  if (l.action === "not_organism") return "Not a fish";
  return "Unable to ID";
}

export function UnknownGallery({
  fish,
  species,
  selected,
  open,
  onToggle,
  onOpen,
}: {
  fish: UnknownFish[];
  species: Species[];
  selected: Set<string>;
  open: string | null;
  onToggle: (trackId: string) => void;
  onOpen: (trackId: string) => void;
}) {
  const name = (id: string) => species.find((s) => s.id === id)?.common ?? id;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {fish.map((f) => (
        <div
          key={f.trackId}
          className={`relative overflow-hidden rounded-xl border-2 bg-card ${open === f.trackId ? "border-primary" : "border-border"}`}
        >
          <input
            type="checkbox"
            className="absolute left-2 top-2 z-10 h-4 w-4"
            checked={selected.has(f.trackId)}
            onChange={() => onToggle(f.trackId)}
            aria-label={`Select fish ${f.trackId}`}
          />
          <button className="block w-full text-left outline-none" onClick={() => onOpen(f.trackId)}>
            <img src={f.crop} alt="Fish to label" className="h-32 w-full bg-black object-contain" loading="lazy" />
            <div className="space-y-1 p-2 text-xs">
              <div className="truncate font-medium" title={f.source.file}>
                {f.source.file}
              </div>
              <div className="text-muted-foreground">
                {f.source.kind === "image"
                  ? "Photo"
                  : f.source.role === "point"
                    ? `Point ${f.source.pointNo} · ${f.source.timestamp}`
                    : `Richness scan · ${f.source.timestamp}`}
              </div>
              {f.suggestions.length > 0 && (
                <div className="truncate text-muted-foreground">
                  {f.suggestions.map((s) => `${name(s.speciesId)} ${s.score.toFixed(2)}`).join(" · ")}
                </div>
              )}
              <div>
                {f.label ? (
                  <Chip tone="done">{labelText(f, species)}</Chip>
                ) : f.aiLabel === "Potential Novel Sighting" ? (
                  <Chip tone="review" icon="?">
                    Potential novel sighting
                  </Chip>
                ) : (
                  <Chip tone="waiting">Unknown</Chip>
                )}
              </div>
            </div>
          </button>
        </div>
      ))}
    </div>
  );
}
