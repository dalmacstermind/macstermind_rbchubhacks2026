// Settings: protocol settings (window, points, blind QC), people, and disk space.
// Per-survey choices (certainty, sampling, clear-up, specks) are made on the New survey page.
import { useEffect, useState, type MutableRefObject, type ReactNode } from "react";
import type { Person, Storage } from "../../../shared/api";
import { api } from "../api";
import { ProtocolSettingsPanel } from "../components/ProtocolSettingsPanel";
import { UnsavedSettingsDialog } from "../components/UnsavedSettingsDialog";
import { Header, btnLink, formatBytes, useConfirm } from "../ui";
import { useProtocolForm } from "../useProtocolForm";

/** Set while Settings has unsaved changes: call it instead of leaving, and it asks first. */
export type LeaveGuard = (continueLeaving: () => void) => void;

export function SettingsView({
  person,
  leaveGuard,
}: {
  person: Person;
  leaveGuard: MutableRefObject<LeaveGuard | null>;
}) {
  const [storage, setStorage] = useState<Storage | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [confirmNode, confirm] = useConfirm();
  const protocol = useProtocolForm(person);
  // What to do once the popup is answered (null: no popup). Kept in an object because React would
  // call a plain function passed to a state setter.
  const [leaving, setLeaving] = useState<{ go: () => void } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void api.storage().then(setStorage);
    void api.people.list().then(setPeople);
  }, []);
  const used = storage ? (storage.totalBytes - storage.freeBytes) / storage.totalBytes : 0;
  const low = storage !== null && storage.freeBytes < 20 * 1024 ** 3;

  // After every render, tell the app whether leaving this screen needs the popup. Cleared when
  // Settings closes, so the other screens are never held up.
  const dirty = protocol.changes.length > 0;
  useEffect(() => {
    leaveGuard.current = dirty ? (go) => setLeaving({ go }) : null;
    return () => {
      leaveGuard.current = null;
    };
  });

  const saveAndLeave = async () => {
    setSaving(true);
    const saved = await protocol.save();
    setSaving(false);
    if (saved) leaving?.go();
    if (saved) setLeaving(null);
  };

  return (
    <>
      {confirmNode}
      {leaving && (
        <UnsavedSettingsDialog
          changes={protocol.changes}
          person={person.name}
          blocked={protocol.hasErrors}
          error={protocol.error}
          saving={saving}
          onSave={() => void saveAndLeave()}
          onDiscard={leaving.go}
          onClose={() => setLeaving(null)}
        />
      )}
      <Header eyebrow="Tools" title="Settings" />
      {/* Two columns side by side: Storage and People on the left, Protocol settings on the right. */}
      <div className="grid grid-cols-1 items-start gap-6 px-10 py-8 lg:grid-cols-2">
        <div className="space-y-6">
          <StorageSection storage={storage} used={used} low={low} />
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
        </div>

        <Section title="Protocol settings">
          <ProtocolSettingsPanel person={person} form={protocol} />
        </Section>
      </div>
    </>
  );
}

function StorageSection({ storage, used, low }: { storage: Storage | null; used: number; low: boolean }) {
  return (
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
