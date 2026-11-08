// Reference pictures of one species. The species model (BioCLIP 2) compares every fish with these,
// so adding a few clear pictures lets the app suggest this species. No retraining is needed.
import { useEffect, useState } from "react";
import type { Person, Reference } from "../../../shared/api";
import type { Species } from "../../../shared/survey";
import { api } from "../api";
import { Modal, btnGhost, btnPrimary, plural } from "../ui";

export function ReferencePictures({
  sp,
  person,
  onClose,
  onChanged,
}: {
  sp: Species;
  person: Person;
  onClose: () => void;
  onChanged: () => void; // the species list shows how many pictures each species has
}) {
  const [refs, setRefs] = useState<Reference[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Load this species' pictures when the box opens.
  useEffect(() => {
    api.species.references
      .list(sp.id)
      .then(setRefs)
      .catch((e: Error) => setError(e.message));
  }, [sp.id]);

  // Runs one change (add or remove), then refreshes the list and the counts on the Species page.
  const run = async (work: () => Promise<Reference[]>) => {
    setBusy(true);
    setError("");
    try {
      setRefs(await work());
      onChanged();
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
    run(async () => {
      await api.species.references.remove(r.id);
      return api.species.references.list(sp.id);
    });

  return (
    <Modal
      title={`Reference pictures · ${sp.common}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className={btnGhost} onClick={onClose}>
            Close
          </button>
          <button className={btnPrimary} onClick={() => void add()} disabled={busy}>
            {busy ? "Working…" : "+ Add pictures"}
          </button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Add a few clear pictures of {sp.common}: different sides, sizes and water conditions help. After adding
        pictures, use <b>Match species again</b> on a survey's report to update its suggestions.
      </p>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      {refs === null ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      ) : refs.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No pictures yet, so the app can't suggest this species.
        </p>
      ) : (
        <>
          <p className="mt-4 text-xs text-muted-foreground">{plural(refs.length, "picture")}</p>
          <div className="mt-2 grid grid-cols-3 gap-3">
            {refs.map((r) => (
              <figure key={r.id} className="overflow-hidden rounded-xl border border-border bg-secondary/40">
                <img src={r.image} alt={`Reference picture of ${sp.common}`} className="h-28 w-full object-contain" />
                <figcaption className="flex items-center justify-between gap-1 px-2 py-1 text-[11px]">
                  <span className="truncate text-muted-foreground" title={`${r.source} · ${r.addedBy || "someone"}`}>
                    {r.source}
                  </span>
                  <button
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => void remove(r)}
                    disabled={busy}
                    aria-label={`Remove reference picture ${r.source}`}
                  >
                    Remove
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
