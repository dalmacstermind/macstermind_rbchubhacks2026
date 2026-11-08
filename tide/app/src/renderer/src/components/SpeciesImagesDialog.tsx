// The species dialog on the Species Registry page: its names, all its reference pictures (click one
// to see it larger, with where it came from), "Add pictures", and the Details. Close, Esc or a click
// outside closes it, and keyboard focus then goes back to the card that opened it (see Modal in ui.tsx).
import { useEffect, useState } from "react";
import type { Person, Reference } from "../../../shared/api";
import { UNKNOWN, type Species, type SpeciesStatus } from "../../../shared/survey";
import { api } from "../api";
import { describeSource, imageCount, knownScientific } from "../speciesRegistry";
import { Modal, btnGhost, btnPrimary, useConfirm } from "../ui";
import { ReferenceImageView } from "./ReferenceImageView";
import { SpeciesDetails } from "./SpeciesDetails";

export function SpeciesImagesDialog({
  sp,
  person,
  onClose,
  onChanged,
}: {
  sp: Species;
  person: Person;
  onClose: () => void;
  onChanged: (list: Species[]) => void; // refreshes the cards behind the dialog (counts, thumbnail)
}) {
  const [refs, setRefs] = useState<Reference[] | null>(null);
  const [selected, setSelected] = useState<Reference | null>(null); // the picture shown large, if any
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmNode, confirm] = useConfirm();
  const pictures = sp.id !== UNKNOWN; // "Unknown" is a fixed label, not a species with pictures

  // Load this species' pictures when the dialog opens.
  useEffect(() => {
    if (!pictures) return;
    api.species.references
      .list(sp.id)
      .then(setRefs)
      .catch((e: Error) => setError(e.message));
  }, [sp.id, pictures]);

  // Runs one change (add or remove), then refreshes the pictures here and the cards behind the dialog.
  const run = async (work: () => Promise<Reference[]>) => {
    setBusy(true);
    setError("");
    try {
      setRefs(await work());
      onChanged(await api.species.list());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    const paths = await window.desktop.pickImages();
    if (paths.length) await run(() => api.species.references.add(sp.id, paths, person.name));
  };
  const remove = (r: Reference) =>
    confirm(
      `Remove this reference image of ${sp.common}? TIDE won't compare fish with it any more.`,
      "Remove image",
      () => {
        setSelected(null);
        void run(() => api.species.references.remove(sp.id, r.id, person.name));
      },
    );
  const setStatus = (status: SpeciesStatus) =>
    void api.species.update(sp.id, { status }).then(onChanged, (e: Error) => setError(e.message));
  const removeSpecies = () =>
    confirm(
      `Remove ${sp.common} from the Species Registry?`,
      "Remove species",
      () =>
        void api.species.remove(sp.id).then((list) => {
          onChanged(list);
          onClose();
        }),
    );
  const scientific = knownScientific(sp.scientific);

  return (
    <Modal
      title={sp.common}
      onClose={onClose}
      wide="xl"
      footer={
        <button type="button" className={btnGhost} onClick={onClose}>
          Close
        </button>
      }
    >
      {confirmNode}
      {scientific && <p className="-mt-3 mb-4 italic text-muted-foreground">{scientific}</p>}
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      <div className="grid gap-5 md:grid-cols-[1fr_17rem]">
        <section aria-label="Reference images" className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-sm font-medium">
              {pictures ? (refs ? imageCount(refs.length) : "Reference images") : "Reference images"}
            </span>
            {pictures && (
              <button type="button" className={btnPrimary} onClick={() => void add()} disabled={busy}>
                {busy ? "Working…" : "+ Add pictures"}
              </button>
            )}
          </div>
          {!pictures ? (
            <Empty>This label is used when the species can't be told, so it has no reference images.</Empty>
          ) : refs === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : selected ? (
            <ReferenceImageView
              r={selected}
              common={sp.common}
              busy={busy}
              onBack={() => setSelected(null)}
              onRemove={() => remove(selected)}
            />
          ) : refs.length === 0 ? (
            <Empty>No reference images yet. Add a few clear pictures so TIDE can suggest {sp.common}.</Empty>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
              {refs.map((r, i) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(r)}
                    aria-label={`Reference image ${i + 1}: ${describeSource(r)}`}
                    className="block w-full overflow-hidden rounded-xl border border-border bg-secondary/40 outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <img src={r.image} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <SpeciesDetails sp={sp} onStatus={setStatus} onRemove={removeSpecies} />
      </div>
    </Modal>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
