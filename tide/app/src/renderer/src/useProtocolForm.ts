// The protocol settings being edited on the Settings screen. It lives in a hook so the panel and
// the "save your changes?" popup work on the same edits.
import { useEffect, useState } from "react";
import type { Person, ProtocolCheck, ProtocolSettings, ProtocolSettingsState } from "../../shared/api";
import { api } from "./api";
import { changedFields } from "./protocolSettings";

export function useProtocolForm(person: Person) {
  const [state, setState] = useState<ProtocolSettingsState | null>(null);
  const [draft, setDraft] = useState<ProtocolSettings | null>(null);
  const [check, setCheck] = useState<ProtocolCheck | null>(null);
  const [error, setError] = useState("");

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

  const changes = state && draft ? changedFields(state.values, draft) : [];
  const hasErrors = Object.keys(check?.errors ?? {}).length > 0;

  /** Returns false if the back end refused the values; the reason is then in `error`. */
  const save = async () => {
    if (!draft) return false;
    try {
      show(await api.settings.protocol.save(draft, person.name));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const reset = () =>
    void api.settings.protocol.reset(person.name).then(show, (e: Error) => setError(e.message));
  const undo = () => {
    if (state) setDraft(state.values);
  };

  return { state, draft, setDraft, check, error, changes, hasErrors, save, reset, undo };
}

export type ProtocolForm = ReturnType<typeof useProtocolForm>;
