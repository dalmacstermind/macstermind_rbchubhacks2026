// Labels are CHOSEN, never typed (CLAUDE.md, Label picker): every label is a registry species or a
// fixed option, so it always maps to one spreadsheet column. Three parts, top to bottom:
//   1. the AI's top 3 suggestions as buttons (keys 1, 2, 3)
//   2. a searchable combo box (type to filter, pick from the list): Fish species / Invertebrates / Other
//   3. "Add new species…"
// The picker never calls the back end itself: it reports the choice through onChoose.
import { useState } from "react";
import type { InvertebrateType, LabelChoice } from "../../../shared/api";
import { UNKNOWN, type Species } from "../../../shared/survey";
import { useKeys } from "../shortcuts";
import { SpeciesCombobox, type ComboOption } from "./SpeciesCombobox";
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
  insideDialog = false,
}: {
  species: Species[];
  suggestions: { speciesId: string; score: number }[];
  onChoose: (choice: LabelChoice) => void;
  onAddSpecies: (typedName?: string) => void;
  disabled?: boolean;
  insideDialog?: boolean; // shown in a dialog: keys 1–3 still work there
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
    true,
    insideDialog,
  );

  // Everything the label can be, grouped like the old dropdown: fish species (recently used first),
  // invertebrates, and the two fixed options. Values encode the action, e.g. "species:cod".
  const fishOption = (s: Species): ComboOption => ({
    value: `species:${s.id}`,
    label: s.common,
    group: "Fish species",
    hint: s.scientific && s.scientific !== "—" ? s.scientific : undefined,
  });
  const comboOptions: ComboOption[] = [
    ...recent.map((id) => fishOption(fish.find((s) => s.id === id)!)),
    ...sorted.filter((s) => !recent.includes(s.id)).map(fishOption),
    ...INVERTEBRATES.map((t) => ({ value: `invertebrate:${t}`, label: t, group: "Invertebrates" })),
    { value: "unidentifiable", label: "Unknown/Unable to ID due to visibility", group: "Other" },
    { value: "not_organism", label: "Not a fish / not an organism", group: "Other" },
  ];

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
      <SpeciesCombobox
        options={comboOptions}
        onChoose={(v) => choose(toChoice(v))}
        onAddNew={(typed) => onAddSpecies(typed)}
        disabled={disabled}
      />
      <button className={btnLink} onClick={() => onAddSpecies()} disabled={disabled}>
        Add new species…
      </button>
    </div>
  );
}
