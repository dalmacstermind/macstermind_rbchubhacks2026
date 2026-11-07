// The species FinCount can name. Staff add new arrivals and change statuses here.
import { useState } from "react";
import type { Person } from "../../../shared/api";
import { STATUS_LABEL, UNKNOWN, type Species, type SpeciesStatus } from "../../../shared/survey";
import { api } from "../api";
import { ReferencePictures } from "../components/ReferencePictures";
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
  const [picturesOf, setPicturesOf] = useState<Species | null>(null);
  const [confirmNode, confirm] = useConfirm();
  const shown = species.filter((s) => `${s.common} ${s.scientific}`.toLowerCase().includes(q.trim().toLowerCase()));
  const statusOptions = (Object.keys(STATUS_LABEL) as SpeciesStatus[]).map((k) => (
    <option key={k} value={k}>
      {STATUS_LABEL[k]}
    </option>
  ));
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
      {picturesOf && (
        <ReferencePictures
          sp={picturesOf}
          person={person}
          onClose={() => setPicturesOf(null)}
          onChanged={() => void api.species.list().then(setSpecies)}
        />
      )}
      <Header eyebrow="Tools" title={`Species list · ${species.length}`}>
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
      <div className="space-y-4 px-10 py-8">
        <p className="max-w-3xl text-sm text-muted-foreground">
          These are the species FinCount can name. Add new arrivals here. Changing a status (for example, marking a
          species as invasive) updates every report straight away. The species model can only suggest a species once
          it has a few reference pictures.
        </p>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Species</th>
                <th className="px-5 py-3">Group</th>
                <th className="px-5 py-3">Habitat</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Reference pictures</th>
                <th className="px-5 py-3">Added by</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {shown.map((sp) => (
                <tr key={sp.id} className="border-t border-border">
                  <td className="px-5 py-3">
                    <div className="font-medium">{sp.common}</div>
                    <div className="text-xs italic text-muted-foreground">{sp.scientific}</div>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {sp.kind === "invertebrate" ? "Invertebrate" : "Fish"}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{sp.habitat}</td>
                  <td className="px-5 py-3">
                    {sp.id === UNKNOWN ? (
                      <span className="text-xs text-muted-foreground">Used when the species can't be told</span>
                    ) : (
                      <select
                        value={sp.status}
                        aria-label={`Status of ${sp.common}`}
                        className="input w-auto py-1"
                        onChange={(e) =>
                          void api.species.update(sp.id, { status: e.target.value as SpeciesStatus }).then(setSpecies)
                        }
                      >
                        {statusOptions}
                      </select>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {sp.id === UNKNOWN ? null : (
                      <button
                        className="text-sm text-primary hover:underline"
                        onClick={() => setPicturesOf(sp)}
                        aria-label={`Reference pictures of ${sp.common}`}
                      >
                        {sp.referenceCount ? `${sp.referenceCount} · manage` : "Add pictures"}
                      </button>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {sp.custom
                      ? `${sp.addedBy || "Someone"}${sp.addedAt ? ` · ${sp.addedAt.slice(0, 10)}` : ""}`
                      : "Came with the app"}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {sp.custom && (
                      <button
                        className="text-xs text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          confirm(
                            `Remove ${sp.common} from the list?`,
                            "Remove",
                            () => void api.species.remove(sp.id).then(setSpecies),
                          )
                        }
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">
                    No species match “{q}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <button
          className={btnGhost}
          onClick={() =>
            confirm(
              "Restore the original species list? Species people added will be removed.",
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
