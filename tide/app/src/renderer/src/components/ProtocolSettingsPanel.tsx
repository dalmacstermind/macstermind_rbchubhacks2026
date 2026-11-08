// Protocol settings (wireframe 10): analysis window, subsample points and blind QC values used for
// new processing. The back end checks every rule and saves the change with the person's name.
import { useEffect, useState } from "react";
import type { Person, ProtocolCheck, ProtocolSettings, ProtocolSettingsState } from "../../../shared/api";
import { api } from "../api";
import { PROTOCOL_FIELDS, changedFields, shown, stored, type ProtocolField } from "../protocolSettings";
import { Alert, btnGhost, btnPrimary, useConfirm } from "../ui";
import { ProtocolChangeSummary } from "./ProtocolChangeSummary";

const GROUPS = ["Analysis window", "Subsample points", "Blind quality check"] as const;

export function ProtocolSettingsPanel({ person }: { person: Person }) {
  const [state, setState] = useState<ProtocolSettingsState | null>(null);
  const [draft, setDraft] = useState<ProtocolSettings | null>(null);
  const [check, setCheck] = useState<ProtocolCheck | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [confirmNode, confirm] = useConfirm();

  const show = (s: ProtocolSettingsState) => {
    setState(s);
    setDraft(s.values);
    setError("");
  };
  useEffect(() => {
    void api.settings.protocol.get().then(show);
  }, []);

  // While someone types, ask the back end (after a short pause) how many points a window gets and
  // whether any value breaks a protocol rule. Nothing is saved by this.
  useEffect(() => {
    if (!draft) return;
    const timer = setTimeout(() => void api.settings.protocol.check(draft).then(setCheck), 300);
    return () => clearTimeout(timer);
  }, [draft]);

  if (!state || !draft) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const changes = changedFields(state.values, draft);
  const errors = check?.errors ?? {};
  const hasErrors = Object.keys(errors).length > 0;
  const set = (f: ProtocolField, typed: number) => setDraft({ ...draft, [f.key]: stored(f, typed) });

  const save = async () => {
    setConfirming(false);
    try {
      show(await api.settings.protocol.save(draft, person.name));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const reset = () =>
    confirm(
      "Go back to the default protocol settings for new surveys? Surveys already processed keep their values.",
      "Use the defaults",
      () => void api.settings.protocol.reset(person.name).then(show, (e: Error) => setError(e.message)),
    );

  return (
    <div className="space-y-5">
      {confirmNode}
      {confirming && (
        <ProtocolChangeSummary
          changes={changes}
          person={person.name}
          onConfirm={() => void save()}
          onClose={() => setConfirming(false)}
        />
      )}
      {state.warning && (
        <Alert tone="warning" icon="⚠" title="Saved settings couldn't be read">
          {state.warning}
        </Alert>
      )}
      {GROUPS.map((group) => (
        <div key={group} className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</div>
          {PROTOCOL_FIELDS.filter((f) => f.group === group).map((f) => (
            <label key={f.key} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 text-sm">
              <span>{f.label}</span>
              <span className="flex items-center gap-2">
                <input
                  type="number"
                  className={`input w-24 py-1 ${errors[f.key] ? "border-destructive" : ""}`}
                  value={shown(f, draft)}
                  step="any"
                  aria-invalid={!!errors[f.key]}
                  onChange={(e) => set(f, Number(e.target.value))}
                />
                <span className="w-10 text-muted-foreground">{f.unit.replace("± ", "")}</span>
              </span>
              <Hint field={f} draft={draft} check={check} />
            </label>
          ))}
        </div>
      ))}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <button className={btnPrimary} disabled={!changes.length || hasErrors} onClick={() => setConfirming(true)}>
          Save…
        </button>
        {changes.length > 0 && (
          <button className={btnGhost} onClick={() => setDraft(state.values)}>
            Undo my edits
          </button>
        )}
        <button className={btnGhost} disabled={state.source === "default"} onClick={reset}>
          Reset to defaults
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {state.source === "custom"
          ? `Last changed by ${state.changedBy || "someone"}${state.changedAt ? ` on ${state.changedAt}` : ""}.`
          : "Using the default protocol settings."}{" "}
        Changes apply to new processing only; surveys already processed keep the values they were processed with.
      </p>
    </div>
  );
}

/** Under a field: what's wrong with it, or a helpful extra (points per window, the tolerance limit). */
function Hint({ field, draft, check }: { field: ProtocolField; draft: ProtocolSettings; check: ProtocolCheck | null }) {
  const problem = check?.errors[field.key];
  if (problem) return <span className="col-span-2 text-xs text-destructive">{problem}</span>;
  if (field.key === "intervalS" && check?.pointsPerWindow)
    return (
      <span className="col-span-2 text-xs text-muted-foreground">→ {check.pointsPerWindow} points per window</span>
    );
  if (field.key === "toleranceS")
    return (
      <span className="col-span-2 text-xs text-muted-foreground">
        Never more than ±{draft.maxToleranceS} s (protocol)
      </span>
    );
  return null;
}
