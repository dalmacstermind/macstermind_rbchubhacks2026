// The Species Registry cards, alphabetical by common name and filtered by the search box.
// Always three cards per row; the cards get wider or narrower with the window.
import type { Species } from "../../../shared/survey";
import { filterSpecies, sortSpecies } from "../speciesRegistry";
import { SpeciesCard } from "./SpeciesCard";

export function SpeciesGrid({
  species,
  query,
  onOpen,
}: {
  species: Species[];
  query: string; // what's typed in the search box
  onOpen: (sp: Species) => void;
}) {
  const shown = sortSpecies(filterSpecies(species, query));
  if (!shown.length)
    return <p className="py-10 text-center text-muted-foreground">No species match “{query.trim()}”.</p>;
  return (
    <ul className="grid grid-cols-3 gap-4" aria-label="Species">
      {shown.map((sp) => (
        <li key={sp.id} className="flex">
          <SpeciesCard sp={sp} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  );
}
