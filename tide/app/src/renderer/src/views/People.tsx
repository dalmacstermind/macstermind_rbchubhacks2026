// "Who's working?" — a dialog over the (blurred, locked) app when it starts and when someone switches
// person. It can't be closed without picking or adding a name. No passwords: the name is saved with
// every check, label and QC count, and blind QC uses it to make sure a different person recounts.
import { useEffect, useRef, useState } from "react";
import type { Person } from "../../../shared/api";
import { api } from "../api";
import { Field, btnGhost, btnPrimary, initials } from "../ui";

const LAST = "tide.lastPerson";

export function WhoIsWorking({ onPick }: { onPick: (p: Person) => void }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);
  let last = "";
  try {
    last = localStorage.getItem(LAST) ?? "";
  } catch {
    /* fine */
  }

  useEffect(() => {
    void api.people.list().then((p) => {
      setPeople(p);
      if (!p.length) setAdding(true);
    });
  }, []);

  // Once the names have loaded, put keyboard focus on a name card (the person who used this computer
  // last, else the first card), so Enter picks it straight away. When the add-a-name form is open,
  // its Name field takes focus instead (autoFocus).
  useEffect(() => {
    if (!people || adding) return;
    (
      box.current?.querySelector<HTMLElement>("[data-first-focus]") ?? box.current?.querySelector<HTMLElement>("button")
    )?.focus();
  }, [people, adding]);

  const pick = (p: Person) => {
    try {
      localStorage.setItem(LAST, p.name);
    } catch {
      /* fine */
    }
    onPick(p);
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    try {
      await api.people.add({ name: n, role: role.trim() });
      pick({ name: n, role: role.trim() });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!people) return null;
  // Which card gets keyboard focus first: the person who used this computer last, else the first one.
  const focusName = people.some((p) => p.name === last) ? last : people[0]?.name;
  return (
    // No Esc and no close button on purpose: the app stays locked until a name is chosen.
    // Clicking the dimmed area around the dialog does nothing, and keeps keyboard focus in the dialog.
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-auto bg-background/30 px-6 py-10"
      onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="who-title"
        aria-describedby="who-desc"
        className="tide-enter w-full max-w-2xl rounded-3xl border border-border bg-card p-8 text-center text-card-foreground shadow-2xl"
      >
        <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-xl bg-gradient-ocean font-display text-2xl font-bold text-primary-foreground">
          T
        </div>
        <h2 id="who-title" className="font-display text-3xl font-semibold">
          Who's working today?
        </h2>
        <p id="who-desc" className="mt-2 text-sm text-muted-foreground">
          Your name is saved with your checks and QC counts. No password needed.
        </p>

        {people.length > 0 && (
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {people.map((p) => (
              <button
                key={p.name}
                data-first-focus={p.name === focusName ? "" : undefined}
                onClick={() => pick(p)}
                className={`flex w-40 flex-col items-center gap-2 rounded-2xl border bg-background p-5 outline-none transition hover:border-primary focus-visible:ring-2 focus-visible:ring-ring ${
                  p.name === last ? "border-primary" : "border-border"
                }`}
              >
                <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/15 font-display text-lg font-semibold text-primary">
                  {initials(p.name)}
                </span>
                <span className="font-medium">{p.name}</span>
                {p.role && <span className="text-xs text-muted-foreground">{p.role}</span>}
              </button>
            ))}
          </div>
        )}

        {adding ? (
          <form
            onSubmit={add}
            className="mx-auto mt-8 max-w-sm space-y-4 rounded-2xl border border-border bg-background p-6 text-left"
          >
            <div className="font-display font-semibold">
              {people.length ? "Add a name" : "First time here? Add your name"}
            </div>
            <Field label="Name">
              <input
                autoFocus
                required
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input"
                placeholder="e.g. Alex"
              />
            </Field>
            <Field label="Role (optional)">
              <input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="input"
                placeholder="e.g. analyst, QC reviewer"
              />
            </Field>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              {people.length > 0 && (
                <button type="button" className={btnGhost} onClick={() => setAdding(false)}>
                  Cancel
                </button>
              )}
              <button type="submit" className={btnPrimary}>
                Continue
              </button>
            </div>
          </form>
        ) : (
          <button className={`${btnGhost} mt-6`} onClick={() => setAdding(true)}>
            + Add a name
          </button>
        )}
      </div>
    </div>
  );
}
