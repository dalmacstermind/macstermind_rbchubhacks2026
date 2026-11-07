// Settings: starting values for new surveys, blind QC rules, people, and disk space.
import { useEffect, useState, type ReactNode } from "react";
import type { Person, Sampling, Storage } from "../../../shared/api";
import { api } from "../api";
import { DEFAULT_PREFS, type Prefs } from "../prefs";
import { Field, Header, btnGhost, btnLink, btnPrimary, formatBytes, useConfirm } from "../ui";

export function SettingsView({
  prefs,
  setPrefs,
  person,
}: {
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
  person: Person;
}) {
  const [draft, setDraft] = useState(prefs);
  const [saved, setSaved] = useState(false);
  const [storage, setStorage] = useState<Storage | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [confirmNode, confirm] = useConfirm();
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setDraft({ ...draft, [k]: v });
    setSaved(false);
  };
  useEffect(() => {
    void api.storage().then(setStorage);
    void api.people.list().then(setPeople);
  }, []);
  const changed = JSON.stringify(draft) !== JSON.stringify(prefs);
  const used = storage ? (storage.totalBytes - storage.freeBytes) / storage.totalBytes : 0;
  const low = storage !== null && storage.freeBytes < 20 * 1024 ** 3;

  return (
    <>
      {confirmNode}
      <Header eyebrow="Tools" title="Settings">
        {saved && <span className="text-sm text-success">✓ Saved</span>}
        <button
          className={btnGhost}
          disabled={JSON.stringify(draft) === JSON.stringify(DEFAULT_PREFS)}
          onClick={() => setDraft(DEFAULT_PREFS)}
        >
          Reset to defaults
        </button>
        <button
          className={btnPrimary}
          disabled={!changed}
          onClick={() => {
            setPrefs(draft);
            setSaved(true);
          }}
        >
          Save
        </button>
      </Header>
      <div className="grid grid-cols-1 gap-6 px-10 py-8 xl:grid-cols-2">
        <Section
          title="New surveys start with"
          note="Changes apply to new surveys only. Earlier surveys keep their settings."
        >
          <Field label={`Count automatically at ${Math.round(draft.threshold * 100)}% certainty or higher`}>
            <input
              type="range"
              min={30}
              max={90}
              step={5}
              value={Math.round(draft.threshold * 100)}
              onChange={(e) => set("threshold", +e.target.value / 100)}
              className="w-full accent-primary"
            />
          </Field>
          <Field label="How closely to check video">
            <select
              className="input"
              value={draft.sampling}
              onChange={(e) => set("sampling", +e.target.value as Sampling)}
            >
              <option value={1}>Standard: 1 picture every second</option>
              <option value={2}>Detailed: 2 pictures every second</option>
              <option value={5}>Thorough: 5 pictures every second</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary"
              checked={draft.enhance}
              onChange={(e) => set("enhance", e.target.checked)}
            />
            Clear up murky or cloudy water
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary"
              checked={draft.ignoreSpecks}
              onChange={(e) => set("ignoreSpecks", e.target.checked)}
            />
            Ignore tiny specks (sediment, bubbles)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-primary"
              checked={draft.notify}
              onChange={(e) => set("notify", e.target.checked)}
            />
            Desktop notification when counting finishes
          </label>
        </Section>

        <Section title="Blind quality check">
          <NumberField
            label="Pictures to recount"
            suffix="% of each survey"
            value={draft.qcPercent}
            min={1}
            max={100}
            onChange={(v) => set("qcPercent", v)}
          />
          <NumberField
            label="Ask for a recount when counts differ by more than"
            suffix="%"
            value={draft.qcMaxDiff}
            min={0}
            max={100}
            onChange={(v) => set("qcMaxDiff", v)}
          />
          <NumberField
            label="Agreement target"
            suffix="% of recounted pictures"
            value={draft.qcTarget}
            min={50}
            max={100}
            onChange={(v) => set("qcTarget", v)}
          />
          <p className="text-xs text-muted-foreground">
            The sample for a survey is picked the first time someone opens its quality check, then kept.
          </p>
        </Section>

        <Section title="People">
          {people.length === 0 ? (
            <p className="text-sm text-muted-foreground">No names yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {people.map((p) => (
                <li key={p.name} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span>
                    {p.name}
                    {p.role && <span className="text-muted-foreground"> · {p.role}</span>}
                    {p.name === person.name && <span className="text-muted-foreground"> (you)</span>}
                  </span>
                  {p.name !== person.name && (
                    <button
                      className="text-xs text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        confirm(
                          `Remove ${p.name} from the list? Their past checks keep their name.`,
                          "Remove",
                          () => void api.people.remove(p.name).then(setPeople),
                        )
                      }
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Storage">
          {!storage ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div>
                <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={`h-full ${low ? "bg-warning" : "bg-gradient-ocean"}`}
                    style={{ width: `${Math.round(used * 100)}%` }}
                  />
                </div>
                <div className={`mt-2 text-sm ${low ? "text-warning-ink" : ""}`}>
                  {low && "⚠ "}
                  {formatBytes(storage.freeBytes)} free of {formatBytes(storage.totalBytes)}
                  {low && " — running low"}
                </div>
              </div>
              <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
                <dt className="text-muted-foreground">Saved survey pictures</dt>
                <dd>{formatBytes(storage.picturesBytes)}</dd>
                <dt className="text-muted-foreground">Database</dt>
                <dd>{formatBytes(storage.databaseBytes)}</dd>
              </dl>
              <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
                <span className="truncate">Data folder: {storage.dataDir}</span>
                <button className={btnLink} onClick={() => window.desktop.openPath(storage.dataDir)}>
                  Open
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Your original videos are never copied or changed. Deleting a survey frees its pictures.
              </p>
            </>
          )}
        </Section>
      </div>
    </>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="h-fit space-y-4 rounded-2xl border border-border bg-card p-6">
      <div className="font-display text-lg font-semibold">{title}</div>
      {children}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}

function NumberField({
  label,
  suffix,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="number"
          className="input w-24"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || 0)))}
        />
        <span className="text-sm text-muted-foreground">{suffix}</span>
      </div>
    </Field>
  );
}
