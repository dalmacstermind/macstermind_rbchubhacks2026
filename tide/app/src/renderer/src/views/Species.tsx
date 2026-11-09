// The Species Registry: the species TIDE can name, as cards (CLAUDE.md, Species Registry). Click a
// card to see its reference pictures and details. Staff add new arrivals here.
import { useState } from "react";
import type { Person } from "../../../shared/api";
import type { Species } from "../../../shared/survey";
import { api } from "../api";
import { SpeciesGrid } from "../components/SpeciesGrid";
import { SpeciesImagesDialog } from "../components/SpeciesImagesDialog";
import { Header, btnGhost, btnPrimary, useConfirm } from "../ui";
import { AddSpecies } from "./Review";

export function SpeciesView({
  species,
  setSpecies,
  person,
}: {
  species: Species[];
  setSpecies: (s: Species[]) => void;
  person: Person;
}) {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  // Remember which species is open by its id, so the dialog always shows its latest details.
  const [openId, setOpenId] = useState<string | null>(null);
  const open = species.find((s) => s.id === openId);
  const [confirmNode, confirm] = useConfirm();

  return (
    <>
      {confirmNode}
      {adding && (
        <AddSpecies
          species={species}
          person={person}
          onClose={() => setAdding(false)}
          onAdded={(list) => setSpecies(list)}
        />
      )}
      {open && <SpeciesImagesDialog sp={open} person={person} onClose={() => setOpenId(null)} onChanged={setSpecies} />}
      <Header eyebrow="Tools" title={`Species Registry · ${species.length}`}>
        <input
          className="input w-64"
          placeholder="Search species…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search species"
        />
        <button className={btnPrimary} onClick={() => setAdding(true)}>
          + Add species
        </button>
      </Header>
      <div className="space-y-6 px-10 py-8">
        <p className="max-w-3xl text-sm text-muted-foreground">
          These are the species TIDE can name. Click a species to see its reference pictures and details. The species
          model can only suggest a species once it has a few reference pictures.
        </p>
        <SpeciesGrid species={species} query={q} onOpen={(sp) => setOpenId(sp.id)} />
        <button
          className={btnGhost}
          onClick={() =>
            confirm(
              "Restore the original Species Registry? Species people added will be removed.",
              "Restore",
              () => void api.species.reset().then(setSpecies),
            )
          }
        >
          Restore original list
        </button>
      </div>
    </>
  );
}
