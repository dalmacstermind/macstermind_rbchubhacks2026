// "Label unknown fish": every fish the AI left as Unknown or Potential Novel Sighting, one card per
// tracked fish across the survey's videos and images. Labels are reversible, and the AI's own result
// is kept by the back end. Counts (per point, MeanCount, richness) update after every label.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LabelChoice, Person, SurveyData, Unknowns } from "../../../shared/api";
import type { Species } from "../../../shared/survey";
import { api } from "../api";
import { LabelCanvas } from "../components/LabelCanvas";
import { LabelPicker } from "../components/LabelPicker";
import { UnknownGallery, labelText } from "../components/UnknownGallery";
import { Header, btnGhost, btnLink, plural } from "../ui";
import { AddSpecies } from "./Review";

type Show = "todo" | "labelled" | "all";
type Drawn = { frameId: string; box: { x: number; y: number; w: number; h: number } };

export function LabelView({
  data,
  species,
  setSpecies,
  person,
  onChanged,
}: {
  data: SurveyData;
  species: Species[];
  setSpecies: (s: Species[]) => void;
  person: Person;
  onChanged: () => void; // reload the survey so "Check the fish" and the report show the labels
}) {
  const surveyId = data.survey.id;
  const [unknowns, setUnknowns] = useState<Unknowns | null>(null);
  const [show, setShow] = useState<Show>("todo");
  const [file, setFile] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const [asReference, setAsReference] = useState(false);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState("");
  const frames = useMemo(() => new Map(data.frames.map((f) => [f.id, f])), [data.frames]);

  const load = useCallback(() => void api.surveys.unknowns(surveyId).then(setUnknowns), [surveyId]);
  // Load the gallery when the survey changes.
  useEffect(load, [load]);

  const files = [...new Set((unknowns?.fish ?? []).map((f) => f.source.file))];
  const shown = (unknowns?.fish ?? []).filter(
    (f) => (!file || f.source.file === file) && (show === "all" || (show === "todo") === !f.label),
  );
  const card = unknowns?.fish.find((f) => f.trackId === open) ?? null;
  const targets = selected.size ? [...selected] : open ? [open] : [];

  // Apply one label to the drawn box, or to every ticked card (bulk), or to the open card.
  const apply = async (choice: LabelChoice) => {
    setMessage("");
    try {
      const r = await api.labels.add({
        ...choice,
        surveyId,
        by: person.name,
        useAsReference: asReference && choice.action === "species",
        ...(drawn ? { frameId: drawn.frameId, box: drawn.box } : { trackIds: targets }),
      });
      setMessage(`Labelled ${plural(drawn ? 1 : targets.length, "fish", "fish")}. ${r.remaining} still to label.`);
      setSelected(new Set());
      setDrawn(null);
      load();
      onChanged();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const undo = async (labelId: string) => {
    await api.labels.undo(labelId);
    load();
    onChanged();
  };

  return (
    <>
      {adding && (
        <AddSpecies
          species={species}
          person={person}
          onClose={() => setAdding(false)}
          onAdded={(list, added) => {
            setSpecies(list);
            if (added) void apply({ action: "species", species: added.id });
          }}
        />
      )}
      <Header eyebrow={`Step 5 · ${data.survey.site}`} title="Label unknown fish">
        <span className="text-sm text-muted-foreground">
          {unknowns ? `${unknowns.remaining} still to label` : "Loading…"}
          {file && unknowns ? ` · ${unknowns.remainingByFile[file] ?? 0} in this file` : ""}
        </span>
      </Header>
      <div className="grid grid-cols-1 gap-6 px-10 py-6 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <select className="input w-auto py-1.5" value={show} onChange={(e) => setShow(e.target.value as Show)}>
              <option value="todo">Still to label</option>
              <option value="labelled">Labelled</option>
              <option value="all">All</option>
            </select>
            <select className="input w-auto py-1.5" value={file} onChange={(e) => setFile(e.target.value)}>
              <option value="">All videos and images</option>
              {files.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            {selected.size > 0 && (
              <button className={btnLink} onClick={() => setSelected(new Set())}>
                Clear {selected.size} selected
              </button>
            )}
          </div>
          {!shown.length ? (
            <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {show === "todo" ? "Nothing left to label here." : "No fish here."}
            </p>
          ) : (
            <UnknownGallery
              fish={shown}
              species={species}
              selected={selected}
              open={open}
              onToggle={(id) => {
                const next = new Set(selected);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                setSelected(next);
              }}
              onOpen={(id) => {
                setOpen(id);
                setDrawn(null);
              }}
            />
          )}
        </div>

        <aside className="space-y-4">
          {card ? (
            <LabelCanvas
              key={card.trackId}
              frames={frames}
              frameIds={card.frameIds}
              startId={card.bestFrameId}
              highlight={card.trackId}
              onDraw={(frameId, box) => setDrawn({ frameId, box })}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Click a card to see the fish in its picture.</p>
          )}
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-2 font-display font-semibold">
              {drawn
                ? "Label the box you drew"
                : selected.size
                  ? `Label ${plural(selected.size, "selected fish", "selected fish")}`
                  : card
                    ? card.label
                      ? `Labelled: ${labelText(card, species)}`
                      : card.reason || "What is this?"
                    : "Choose a fish"}
            </div>
            <LabelPicker
              species={species}
              suggestions={selected.size || drawn ? [] : (card?.suggestions ?? [])}
              onChoose={(c) => void apply(c)}
              onAddSpecies={() => setAdding(true)}
              disabled={!drawn && !targets.length}
            />
            <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={asReference} onChange={(e) => setAsReference(e.target.checked)} />
              Use as reference picture (not for test videos used to measure the AI)
            </label>
            {card?.label && (
              <button className={`${btnGhost} mt-3`} onClick={() => void undo(card.label!.id)}>
                Undo this label
              </button>
            )}
            {message && <p className="mt-3 text-sm text-muted-foreground">{message}</p>}
          </div>
        </aside>
      </div>
    </>
  );
}
