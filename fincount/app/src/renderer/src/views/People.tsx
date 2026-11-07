// "Who's working?" — shown when the app starts. No passwords: the name is saved with
// every check, label and QC count, and blind QC uses it to make sure a different person recounts.
import { useEffect, useState } from "react";
import type { Person } from "../../../shared/api";
import { api } from "../api";
import { Field, btnGhost, btnPrimary, initials } from "../ui";

const LAST = "fincount.lastPerson";

export function WhoIsWorking({ onPick }: { onPick: (p: Person) => void }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
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
  return (
    <div className="grid h-screen place-items-center overflow-auto bg-background px-6 text-foreground">
      <div className="w-full max-w-2xl py-10 text-center">
        <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-xl bg-gradient-ocean font-display text-2xl font-bold text-primary-foreground">
          F
        </div>
        <h1 className="font-display text-3xl font-semibold">Who's working today?</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your name is saved with your checks and QC counts. No password needed.
        </p>

        {people.length > 0 && (
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {people.map((p) => (
              <button
                key={p.name}
                onClick={() => pick(p)}
                className={`flex w-40 flex-col items-center gap-2 rounded-2xl border bg-card p-5 outline-none transition hover:border-primary focus-visible:ring-2 focus-visible:ring-ring ${
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
            className="mx-auto mt-8 max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6 text-left"
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
