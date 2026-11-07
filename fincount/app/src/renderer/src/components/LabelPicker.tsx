// Labels are CHOSEN, never typed (CLAUDE.md, Label picker): every label is a registry species or a
// fixed option, so it always maps to one spreadsheet column. Three parts, top to bottom:
//   1. the AI's top 3 suggestions as buttons (keys 1, 2, 3)
//   2. a grouped native <select>: Fish species / Invertebrates / Other
//   3. "Add new species…"
// The picker never calls the back end itself: it reports the choice through onChoose.
import { useState } from "react";
import type { InvertebrateType, LabelChoice } from "../../../shared/api";
import { UNKNOWN, type Species } from "../../../shared/survey";
import { useKeys } from "../shortcuts";
import { Kbd, btnLink, btnPrimary } from "../ui";

const INVERTEBRATES: InvertebrateType[] = ["crab", "shrimp", "worm", "snail"];
const RECENT_KEY = "tide.label.recent"; // only a convenience, kept on this computer

function recentSpecies(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/** Option values encode the action, e.g. "species:cod", "invertebrate:crab", "unidentifiable". */
function toChoice(value: string): LabelChoice {
  const [action, arg] = value.split(":");
  if (action === "species") return { action: "species", species: arg };
  if (action === "invertebrate") return { action: "invertebrate", invertebrateType: arg as InvertebrateType };
  return { action: action as LabelChoice["action"] };
}

export function LabelPicker({
  species,
  suggestions,
  onChoose,
  onAddSpecies,
  disabled,
}: {
  species: Species[];
  suggestions: { speciesId: string; score: number }[];
  onChoose: (choice: LabelChoice) => void;
  onAddSpecies: () => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const fish = species.filter((s) => s.kind !== "invertebrate" && s.id !== UNKNOWN);
  const recent = recentSpecies()
    .filter((id) => fish.some((s) => s.id === id))
    .slice(0, 3);
  const sorted = [...fish].sort((a, b) => a.common.localeCompare(b.common));
  const top = suggestions.filter((s) => fish.some((f) => f.id === s.speciesId)).slice(0, 3);
  const name = (id: string) => species.find((s) => s.id === id)?.common ?? id;

  const choose = (c: LabelChoice) => {
    if (c.action === "species" && c.species) {
      // Pin the most recently used species at the top of the list next time.
      const next = [c.species, ...recentSpecies().filter((id) => id !== c.species)].slice(0, 3);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable: the pin is only a convenience */
      }
    }
    onChoose(c);
    setValue("");
  };

  // Keys 1–3 pick the suggestion buttons.
  useKeys(
    Object.fromEntries(
      top.map((s, i) => [String(i + 1), () => !disabled && choose({ action: "species", species: s.speciesId })]),
    ),
  );

  const option = (s: Species) => (
    <option key={s.id} value={`species:${s.id}`}>
      {s.common}
      {s.scientific && s.scientific !== "—" ? ` (${s.scientific})` : ""}
    </option>
  );

  return (
    <div className="space-y-3">
      {top.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {top.map((s, i) => (
            <button
              key={s.speciesId}
              disabled={disabled}
              onClick={() => choose({ action: "species", species: s.speciesId })}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-sm hover:bg-secondary disabled:opacity-40"
              title="AI suggestion: similarity to the species' reference pictures (not a probability)"
            >
              <Kbd>{i + 1}</Kbd> {name(s.speciesId)}{" "}
              <span className="font-mono text-xs text-muted-foreground">{s.score.toFixed(2)}</span>
            </button>
          ))}
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value) choose(toChoice(value));
        }}
      >
        <select
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          aria-label="Label"
        >
          <option value="" disabled>
            Choose a label…
          </option>
          <optgroup label="Fish species">
            {recent.map((id) => option(fish.find((s) => s.id === id)!))}
            {sorted.filter((s) => !recent.includes(s.id)).map(option)}
          </optgroup>
          <optgroup label="Invertebrates">
            {INVERTEBRATES.map((t) => (
              <option key={t} value={`invertebrate:${t}`}>
                {t}
              </option>
            ))}
          </optgroup>
          <optgroup label="Other">
            <option value="unidentifiable">Unknown/Unable to ID due to visibility</option>
            <option value="not_organism">Not a fish / not an organism</option>
          </optgroup>
        </select>
        <button className={btnPrimary} disabled={!value || disabled}>
          Apply <Kbd>Enter</Kbd>
        </button>
      </form>
      <button className={btnLink} onClick={onAddSpecies} disabled={disabled}>
        Add new species…
      </button>
    </div>
  );
}
