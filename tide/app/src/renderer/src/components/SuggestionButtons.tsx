// The species model's top guesses for one fish, as buttons: one click applies that species.
// Scores are similarity to the species' reference pictures (0–1), not a probability.
import { NOVEL_SIGHTING, type Detection, type Species } from "../../../shared/survey";
import { Chip } from "../ui";

export function SuggestionButtons({
  det,
  species,
  onPick,
}: {
  det: Detection;
  species: Species[];
  onPick: (speciesId: string) => void;
}) {
  const suggestions = (det.suggestions ?? []).filter((s) => species.some((sp) => sp.id === s.speciesId));
  const name = (id: string) => species.find((s) => s.id === id)?.common ?? id;
  const novel = det.aiLabel === NOVEL_SIGHTING;

  // Demo mode and old surveys have no AI suggestions: show nothing.
  if (!suggestions.length && !det.unknownReason && !novel) return null;

  return (
    <div className="mt-4 rounded-xl border border-border bg-secondary/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">AI suggestions</span>
        {novel && (
          <Chip tone="review" icon="?">
            Potential novel sighting
          </Chip>
        )}
      </div>
      {det.unknownReason && <p className="mt-1 text-xs text-muted-foreground">{det.unknownReason}</p>}
      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s.speciesId}
              onClick={() => onPick(s.speciesId)}
              title="Similarity to this species' reference pictures (not a probability)"
              className={`rounded-lg border px-2.5 py-1 text-sm transition hover:bg-secondary ${
                det.speciesId === s.speciesId ? "border-primary bg-primary/10" : "border-border bg-card"
              }`}
            >
              {name(s.speciesId)} <span className="font-mono text-xs text-muted-foreground">{s.score.toFixed(2)}</span>
            </button>
          ))}
        </div>
      )}
      {novel && (
        <p className="mt-2 text-xs text-muted-foreground">
          Far from every species with reference pictures. Worth an expert look before naming it.
        </p>
      )}
    </div>
  );
}
