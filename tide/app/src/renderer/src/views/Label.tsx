// "Label unknown fish": every fish the AI left as Unknown or Potential Novel Sighting, one card per
// tracked fish across the survey's videos and images. Labels are reversible, and the AI's own result
// is kept by the back end. Counts (per point, MeanCount, richness) update after every label.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LabelChoice, Person, SurveyData, Unknowns } from "../../../shared/api";
import type { Species } from "../../../shared/survey";
import { api } from "../api";
import { LabelCanvas } from "../components/LabelCanvas";
import { LabelPanel } from "../components/LabelPanel";
import { NORMAL_LOOK } from "../components/PictureControls";
import { UnknownGallery, labelText } from "../components/UnknownGallery";
import { Header, Modal, btnGhost, btnLink, plural } from "../ui";
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
  const [look, setLook] = useState(NORMAL_LOOK); // brightness and contrast carry over from fish to fish
  const [asReference, setAsReference] = useState(false);
  const [adding, setAdding] = useState<string | null>(null); // null = closed; text = name typed so far
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
  const targets = open ? [open] : [...selected];

  // Stable on purpose: the dialog moves keyboard focus whenever its onClose changes.
  const closeCard = useCallback(() => {
    setOpen(null);
    setDrawn(null);
  }, []);

  // Apply one label to the drawn box, or to the open card, or to every ticked card (bulk).
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
      if (!open) setSelected(new Set());
      setDrawn(null);
      setAsReference(false); // a person decides for each label, so poor crops aren't added by accident
      load();
      onChanged();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  // Ticks are cleared with every filter change, so a fish the filter hides can't be labelled unseen.
  const changeShow = (value: Show) => {
    setShow(value);
    setSelected(new Set());
  };
  const changeFile = (value: string) => {
    setFile(value);
    setSelected(new Set());
  };

  const undo = async (labelId: string) => {
    await api.labels.undo(labelId);
    load();
    onChanged();
  };

  return (
    <>
      {card && (
        <Modal
          title="Look closely and label this fish"
          wide="full"
          onClose={closeCard}
          footer={
            <button className={btnGhost} onClick={closeCard}>
              Close
            </button>
          }
        >
          <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-6">
            <LabelCanvas
              key={card.trackId}
              frames={frames}
              frameIds={card.frameIds}
              startId={card.bestFrameId}
              highlight={card.trackId}
              look={look}
              onLook={setLook}
              pending={drawn}
              onDraw={(frameId, box) => setDrawn({ frameId, box })}
            />
            <LabelPanel
              title={
                drawn
                  ? "Label the box you drew"
                  : card.label
                    ? `Labelled: ${labelText(card, species)}`
                    : card.reason || "What is this?"
              }
              species={species}
              suggestions={drawn ? [] : card.suggestions}
              onChoose={(c) => void apply(c)}
              onAddSpecies={(typed) => setAdding(typed ?? "")}
              insideDialog
              asReference={asReference}
              onAsReference={setAsReference}
              onUndo={card.label && !drawn ? () => void undo(card.label!.id) : undefined}
              message={message}
            />
          </div>
        </Modal>
      )}
      {adding !== null && (
        <AddSpecies
          initialName={adding}
          species={species}
          person={person}
          onClose={() => setAdding(null)}
          onAdded={(list, added) => {
            setSpecies(list);
            if (added) void apply({ action: "species", species: added.id });
          }}
        />
      )}
      <Header eyebrow={`Step 4 of 4 · ${data.survey.site}`} title="Label unknown fish">
        <span className="text-sm text-muted-foreground">
          {unknowns ? `${unknowns.remaining} still to label` : "Loading…"}
          {file && unknowns ? ` · ${unknowns.remainingByFile[file] ?? 0} in this file` : ""}
        </span>
      </Header>
      <div className="grid grid-cols-1 gap-6 px-10 py-6 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <select className="input w-auto py-1.5" value={show} onChange={(e) => changeShow(e.target.value as Show)}>
              <option value="todo">Unlabeled</option>
              <option value="labelled">Labelled</option>
              <option value="all">All</option>
            </select>
            <select className="input w-auto py-1.5" value={file} onChange={(e) => changeFile(e.target.value)}>
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
                setMessage("");
              }}
            />
          )}
        </div>

        {/* Hidden while a card's dialog is open, so keys 1–3 can't reach two pickers. */}
        <aside className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Click a card to see the fish large and draw a missed one. Tick several cards to give them one label.
          </p>
          {!card && (
            <LabelPanel
              title={
                selected.size ? `Label ${plural(selected.size, "selected fish", "selected fish")}` : "Choose a fish"
              }
              species={species}
              suggestions={[]}
              onChoose={(c) => void apply(c)}
              onAddSpecies={(typed) => setAdding(typed ?? "")}
              disabled={!selected.size}
              asReference={asReference}
              onAsReference={setAsReference}
              message={message}
            />
          )}
        </aside>
      </div>
    </>
  );
}
