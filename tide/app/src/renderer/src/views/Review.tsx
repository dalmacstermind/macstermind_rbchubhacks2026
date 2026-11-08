// "Approve Findings": confirm, correct or reject what TIDE found, one picture at a time.
import { useEffect, useMemo, useState } from "react";
import type { Person } from "../../../shared/api";
import {
  NOT_FISH,
  UNKNOWN,
  aiSure,
  needsReview,
  type Detection,
  type Frame,
  type Species,
  type SpeciesStatus,
} from "../../../shared/survey";
import { api } from "../api";
import { DrawLayer } from "../components/DrawLayer";
import { LabelPicker } from "../components/LabelPicker";
import { SpeciesCombobox } from "../components/SpeciesCombobox";
import { SuggestionButtons } from "../components/SuggestionButtons";
import { UseAsReference } from "../components/UseAsReference";
import type { ReviewMode } from "./Report";
import { useKeys } from "../shortcuts";
import { Certainty, Chip, Field, Header, Kbd, Modal, StatusPill, btnGhost, btnLink, btnPrimary, plural } from "../ui";

type Patch = Pick<Detection, "speciesId" | "verified">;

const MODES: Record<ReviewMode, string> = {
  review: "Needs checking",
  label: "Unknown/Unable to ID due to visibility",
  all: "All pictures with fish",
};

export function ReviewView({
  frames,
  species,
  setSpecies,
  threshold,
  total,
  toReview,
  startMode,
  person,
  edit,
  onBack,
  surveyId,
  onReload,
}: {
  frames: Frame[];
  species: Species[];
  setSpecies: (s: Species[]) => void;
  threshold: number;
  total: number;
  toReview: number;
  startMode: ReviewMode;
  person: Person;
  edit: (frameId: string, det: Detection, patch: Patch) => void;
  surveyId: number;
  onReload: () => void; // after adding a fish the AI missed
  onBack: () => void;
}) {
  const matches = (d: Detection, mode: ReviewMode) =>
    mode === "review" ? needsReview(d, threshold) : mode === "label" ? d.speciesId === UNKNOWN && !d.verified : true;
  const [mode, setMode] = useState<ReviewMode>(startMode);
  const withFish = frames.filter((f) => f.detections.length > 0);
  const shown = withFish.filter((f) => f.detections.some((d) => matches(d, mode)));
  const list = shown.length ? shown : withFish;
  const [fi, setFi] = useState(0);
  const frame = list[Math.min(fi, list.length - 1)];
  const [sel, setSel] = useState<string | null>(null);
  const det = frame?.detections.find((d) => d.id === sel);
  const [view, setView] = useState({ brightness: 100, contrast: 100, zoom: 1 });
  const [showView, setShowView] = useState(false);
  const [adding, setAdding] = useState(false);
  const [drawing, setDrawing] = useState(false); // "Add a missed fish": drag a box on the picture
  const [drawn, setDrawn] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [drawError, setDrawError] = useState("");

  const fishSpecies = species.filter((s) => s.kind !== "invertebrate");
  const invSpecies = species.filter((s) => s.kind === "invertebrate");
  const ordered = [...fishSpecies, ...invSpecies];
  const name = (id: string) =>
    id === NOT_FISH ? "Not a fish" : (species.find((s) => s.id === id)?.common ?? "Removed species");

  // Select the next thing to look at whenever the picture or filter changes.
  useEffect(() => {
    if (frame && !frame.detections.some((d) => d.id === sel))
      setSel(
        frame.detections.find((d) => matches(d, mode))?.id ??
          (mode === "all" ? null : (frame.detections[0]?.id ?? null)),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame?.id, mode]);

  const goTo = (i: number) => {
    setFi(Math.max(0, Math.min(list.length - 1, i)));
    setSel(null);
  };
  const apply = (patch: Patch) => det && frame && edit(frame.id, det, patch);
  const moveBox = (step: number) => {
    if (!frame?.detections.length) return;
    const i = frame.detections.findIndex((d) => d.id === sel);
    const n = frame.detections.length;
    setSel(frame.detections[(i + step + n) % n]!.id);
  };

  useKeys({
    ArrowRight: () => goTo(fi + 1),
    ArrowLeft: () => goTo(fi - 1),
    ArrowDown: () => moveBox(1),
    ArrowUp: () => moveBox(-1),
    y: () => det && det.speciesId !== NOT_FISH && apply({ speciesId: det.speciesId, verified: true }),
    n: () => apply({ speciesId: NOT_FISH, verified: true }),
    u: () => det && apply({ speciesId: det.modelSpeciesId, verified: false }),
    ...Object.fromEntries(
      ordered.slice(0, 9).map((sp, i) => [String(i + 1), () => apply({ speciesId: sp.id, verified: true })]),
    ),
  });

  const counts = useMemo(
    () => ({
      review: withFish.flatMap((f) => f.detections).filter((d) => matches(d, "review")).length,
      label: withFish.flatMap((f) => f.detections).filter((d) => matches(d, "label")).length,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frames, threshold],
  );

  if (!frame) {
    return (
      <>
        <Header eyebrow="Step 3 of 4" title="Approve Findings">
          <button onClick={onBack} className={btnPrimary}>
            Back to Counting
          </button>
        </Header>
        <div className="p-10 text-muted-foreground">
          No fish were found in any of the pictures, so there's nothing to check.
        </div>
      </>
    );
  }

  const boxStyle = (d: Detection) =>
    d.speciesId === NOT_FISH
      ? "border-dashed border-muted-foreground/70"
      : needsReview(d, threshold)
        ? "border-dashed border-warning"
        : d.verified
          ? "border-success"
          : "border-detect";
  const tagStyle = (d: Detection) =>
    d.speciesId === NOT_FISH
      ? "bg-muted text-muted-foreground"
      : needsReview(d, threshold)
        ? "bg-warning text-warning-foreground"
        : d.verified
          ? "bg-success text-success-foreground"
          : "bg-detect text-white";
  const filtered = view.brightness !== 100 || view.contrast !== 100 || view.zoom !== 1;

  return (
    <>
      {adding && (
        <AddSpecies
          species={species}
          person={person}
          onClose={() => setAdding(false)}
          onAdded={(list, added) => {
            setSpecies(list);
            if (added) apply({ speciesId: added.id, verified: true });
          }}
        />
      )}
      <Header eyebrow="Step 3 of 4" title="Approve Findings">
        <div className="mr-4 text-sm text-muted-foreground">
          Fish counted: <span className="font-display text-lg font-semibold text-foreground">{total}</span>
          {toReview > 0 && (
            <>
              {" "}
              · <span className="text-warning-ink">{toReview} to check</span>
            </>
          )}
        </div>
        <button onClick={onBack} className={btnPrimary}>
          Done, back to Counting
        </button>
      </Header>
      <div className="grid grid-cols-1 gap-6 px-10 py-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              Show
              <select
                className="input w-auto py-1.5"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as ReviewMode);
                  setFi(0);
                  setSel(null);
                }}
              >
                <option value="review">
                  {MODES.review} ({counts.review})
                </option>
                <option value="label">
                  {MODES.label} ({counts.label})
                </option>
                <option value="all">{MODES.all}</option>
              </select>
            </label>
            <div className="flex items-center gap-2 text-sm">
              <button
                className={`${btnGhost} ${filtered ? "border-primary" : ""}`}
                onClick={() => setShowView(!showView)}
                aria-expanded={showView}
              >
                Adjust view{filtered && " •"}
              </button>
              <button
                className={`${btnGhost} ${drawing ? "border-primary" : ""}`}
                onClick={() => {
                  setDrawing(!drawing);
                  setDrawn(null);
                }}
                aria-pressed={drawing}
              >
                {drawing ? "Drag around the fish…" : "+ Add a missed fish"}
              </button>
              <button
                onClick={() => goTo(fi - 1)}
                disabled={fi === 0}
                className={btnGhost}
                aria-label="Previous picture"
              >
                ←
              </button>
              <span className="text-muted-foreground">
                {Math.min(fi, list.length - 1) + 1} of {list.length}
              </span>
              <button
                onClick={() => goTo(fi + 1)}
                disabled={fi >= list.length - 1}
                className={btnGhost}
                aria-label="Next picture"
              >
                →
              </button>
            </div>
          </div>

          {showView && (
            <div className="mb-3 flex flex-wrap items-center gap-6 rounded-xl border border-border bg-card px-4 py-3 text-sm">
              <span className="text-xs text-muted-foreground">For your eyes only, doesn't change the count:</span>
              {(
                [
                  ["Brightness", "brightness", 50, 200, 5],
                  ["Contrast", "contrast", 50, 200, 5],
                  ["Zoom", "zoom", 1, 3, 0.25],
                ] as const
              ).map(([label, key, min, max, step]) => (
                <label key={key} className="flex items-center gap-2">
                  {label}
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={view[key]}
                    onChange={(e) => setView({ ...view, [key]: Number(e.target.value) })}
                    className="w-28 accent-primary"
                  />
                </label>
              ))}
              <button className={btnLink} onClick={() => setView({ brightness: 100, contrast: 100, zoom: 1 })}>
                Reset
              </button>
            </div>
          )}

          {mode !== "all" && !shown.length && (
            <div className="mb-3 rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm">
              All done: nothing left under “{MODES[mode]}”. Showing all pictures with fish.
            </div>
          )}
          <div className="overflow-auto rounded-2xl border border-border bg-card">
            <div className="relative origin-top-left" style={{ width: `${view.zoom * 100}%` }}>
              <img
                src={frame.image}
                alt={`Picture from ${frame.source} at ${frame.timestamp}`}
                className="block w-full"
                style={{ filter: `brightness(${view.brightness}%) contrast(${view.contrast}%)` }}
              />
              {frame.detections.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setSel(d.id)}
                  aria-label={`${name(d.speciesId)}, ${Math.round(d.confidence * 100)}% sure`}
                  style={{ left: `${d.box.x}%`, top: `${d.box.y}%`, width: `${d.box.w}%`, height: `${d.box.h}%` }}
                  className={`absolute border-2 outline-none transition ${boxStyle(d)} ${sel === d.id ? "ring-4 ring-primary/60" : ""}`}
                >
                  <span
                    className={`absolute left-[-2px] whitespace-nowrap px-1.5 py-0.5 text-[11px] font-medium ${d.box.y < 7 ? "top-0" : "-top-6"} ${tagStyle(d)}`}
                  >
                    {needsReview(d, threshold) ? "Check: " : d.verified ? "✓ " : ""}
                    {name(d.speciesId)}
                  </span>
                </button>
              ))}
              {drawing && (
                <DrawLayer
                  onDrawn={(box) => {
                    setDrawn(box);
                    setDrawing(false);
                  }}
                />
              )}
              {drawn && (
                <span
                  style={{ left: `${drawn.x}%`, top: `${drawn.y}%`, width: `${drawn.w}%`, height: `${drawn.h}%` }}
                  className="pointer-events-none absolute border-2 border-warning"
                />
              )}
              <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-md bg-background/85 px-2 py-1 font-mono text-xs backdrop-blur">
                {frame.source} · {frame.timestamp}
                <PictureQuality frame={frame} />
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <Legend cls="border-detect" label="Counted" />
            <Legend cls="border-success" label="Checked by a person" />
            <Legend cls="border-dashed border-warning" label="Needs checking (not counted yet)" />
            <Legend cls="border-dashed border-muted-foreground" label="Not a fish" />
          </div>
          <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
            {list.map((f, i) => {
              const pending = f.detections.filter((d) => matches(d, mode === "all" ? "review" : mode)).length;
              return (
                <button
                  key={f.id}
                  onClick={() => goTo(i)}
                  className={`relative w-36 shrink-0 overflow-hidden rounded-xl border-2 outline-none transition focus-visible:ring-2 focus-visible:ring-ring ${
                    f.id === frame.id ? "border-primary" : "border-transparent opacity-60 hover:opacity-100"
                  }`}
                >
                  <img src={f.image} alt="" loading="lazy" className="block" />
                  {pending > 0 && (
                    <span className="absolute right-1 top-1 rounded-full bg-warning px-1.5 text-[10px] font-semibold text-warning-foreground">
                      ⚠ {pending}
                    </span>
                  )}
                  <span className="absolute bottom-1 left-1 rounded bg-background/85 px-1.5 font-mono text-[10px]">
                    {f.timestamp}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          {drawn && (
            <div className="rounded-2xl border border-warning/60 bg-card p-5">
              <div className="font-display text-lg font-semibold">Label the fish you drew</div>
              <p className="mt-1 text-sm text-muted-foreground">
                It's added to the count if this picture is inside a point's tolerance window (or it's a photo).
              </p>
              <div className="mt-3">
                <LabelPicker
                  species={species}
                  suggestions={[]}
                  onAddSpecies={() => setAdding(true)}
                  onChoose={(c) =>
                    void api.labels
                      .add({ ...c, surveyId, frameId: frame.id, box: drawn, by: person.name })
                      .then(() => {
                        setDrawn(null);
                        setDrawError("");
                        onReload();
                      })
                      .catch((e: Error) => setDrawError(e.message))
                  }
                />
              </div>
              {drawError && <p className="mt-2 text-sm text-destructive">{drawError}</p>}
              <button className={`${btnLink} mt-3`} onClick={() => setDrawn(null)}>
                Cancel
              </button>
            </div>
          )}
          <div className="rounded-2xl border border-border bg-card p-5">
            {det ? (
              <>
                <div className="font-display text-lg font-semibold">
                  {det.speciesId === NOT_FISH
                    ? "Marked as not a fish"
                    : det.speciesId === UNKNOWN
                      ? "What is this?"
                      : `Is this ${/^[aeiou]/i.test(name(det.speciesId)) ? "an" : "a"} ${name(det.speciesId)}?`}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  TIDE guessed <b className="text-foreground">{name(det.modelSpeciesId)}</b> and was{" "}
                  <Certainty value={det.confidence} />.
                </p>
                {det.verified && det.editedBy && (
                  <p className="mt-2">
                    <Chip tone="done">Checked by {det.editedBy}</Chip>
                  </p>
                )}
                <SuggestionButtons
                  det={det}
                  species={species}
                  onPick={(id) => apply({ speciesId: id, verified: true })}
                />
                {det.speciesId !== NOT_FISH && !det.verified && !needsReview(det, threshold) && (
                  <p className="mt-4">
                    <Chip tone="done">
                      {aiSure(det)
                        ? `Counted automatically: TIDE is sure this is ${/^[aeiou]/i.test(name(det.speciesId)) ? "an" : "a"} ${name(det.speciesId)}.`
                        : `Counted automatically: TIDE was at least ${Math.round(threshold * 100)}% sure.`}{" "}
                      Pick another answer only if it's wrong.
                    </Chip>
                  </p>
                )}
                {det.speciesId !== NOT_FISH && !det.verified && needsReview(det, threshold) && (
                  <button
                    onClick={() => apply({ speciesId: det.speciesId, verified: true })}
                    className={`${btnPrimary} mt-4 w-full`}
                  >
                    {det.speciesId === UNKNOWN ? "It's a fish, species unknown" : "Yes, that's right"} <Kbd>Y</Kbd>
                  </button>
                )}
                {det.possibleDrift && (
                  <p className="mt-2">
                    <Chip tone="review" icon="≈">
                      Moved exactly like the water: debris or weed? Not counted until you confirm.
                    </Chip>
                  </p>
                )}
                <div className="mt-5 text-sm font-medium">{det.speciesId === UNKNOWN ? "It's a…" : "No, it's a…"}</div>
                <div className="mt-2">
                  <SpeciesCombobox
                    placeholder="Type a species to search…"
                    options={[
                      ...ordered.map((sp) => ({
                        value: sp.id,
                        label: sp.common,
                        group: sp.kind === "invertebrate" ? "Invertebrates" : "Fish",
                        hint: sp.scientific && sp.scientific !== "—" ? sp.scientific : undefined,
                      })),
                      { value: NOT_FISH, label: "Not a fish (seaweed, sediment, debris)", group: "Other" },
                    ]}
                    onChoose={(id) => apply({ speciesId: id, verified: true })}
                    onAddNew={() => setAdding(true)}
                  />
                </div>
                <div className="mt-2 max-h-72 space-y-0.5 overflow-auto pr-1">
                  <PickGroup
                    label="Fish"
                    list={fishSpecies}
                    offset={0}
                    det={det}
                    onPick={(id) => apply({ speciesId: id, verified: true })}
                  />
                  {invSpecies.length > 0 && (
                    <PickGroup
                      label="Invertebrates"
                      list={invSpecies}
                      offset={fishSpecies.length}
                      det={det}
                      onPick={(id) => apply({ speciesId: id, verified: true })}
                    />
                  )}
                </div>
                <button
                  onClick={() => apply({ speciesId: NOT_FISH, verified: true })}
                  className={`mt-2 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                    det.speciesId === NOT_FISH
                      ? "border-muted-foreground bg-muted"
                      : "border-dashed border-border hover:bg-secondary"
                  }`}
                >
                  Not a fish (seaweed, sediment, debris) <Kbd>N</Kbd>
                </button>
                <UseAsReference
                  det={det}
                  species={species}
                  person={person}
                  onAdded={() => void api.species.list().then(setSpecies)}
                />
                <div className="mt-3 flex items-center justify-between text-xs">
                  <button onClick={() => setAdding(true)} className={btnLink}>
                    + Species not listed
                  </button>
                  {(det.verified || det.speciesId !== det.modelSpeciesId) && (
                    <button
                      onClick={() => apply({ speciesId: det.modelSpeciesId, verified: false })}
                      className="text-muted-foreground hover:text-foreground hover:underline"
                    >
                      Undo my change <Kbd>U</Kbd>
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="font-display font-semibold">How to check</div>
                <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
                  <li>Click a box on the picture.</li>
                  <li>Confirm the species, pick the right one, or mark it as not a fish.</li>
                  <li>The Counting page updates as you go, and your checks are saved straight away.</li>
                </ol>
                <p className="mt-3 text-xs text-muted-foreground">
                  Press <Kbd>?</Kbd> for keyboard shortcuts.
                </p>
              </>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-2 font-display font-semibold">
              In this picture · {plural(frame.detections.length, "box", "boxes")}
            </div>
            <div className="space-y-0.5">
              {frame.detections.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setSel(d.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                    sel === d.id ? "bg-secondary" : "hover:bg-secondary/60"
                  }`}
                >
                  <span className={d.speciesId === NOT_FISH ? "text-muted-foreground line-through" : ""}>
                    {name(d.speciesId)}
                  </span>
                  {needsReview(d, threshold) ? (
                    <Chip tone="review">Check</Chip>
                  ) : d.verified ? (
                    <Chip tone="done">Checked</Chip>
                  ) : (
                    <span className="text-xs text-muted-foreground">{Math.round(d.confidence * 100)}% sure</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function PickGroup({
  label,
  list,
  offset,
  det,
  onPick,
}: {
  label: string;
  list: Species[];
  offset: number;
  det: Detection;
  onPick: (id: string) => void;
}) {
  return (
    <>
      <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {list.map((sp, i) => (
        <button
          key={sp.id}
          onClick={() => onPick(sp.id)}
          className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left text-sm transition ${
            det.speciesId === sp.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-secondary"
          }`}
        >
          <span className="flex items-center gap-2">
            {offset + i < 9 ? <Kbd>{offset + i + 1}</Kbd> : <span className="w-5" />}
            {sp.common}
          </span>
          {sp.status !== "native" && <StatusPill status={sp.status} />}
        </button>
      ))}
    </>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-3 w-4 border-2 ${cls}`} />
      {label}
    </span>
  );
}

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/** Add a species without leaving the picture. Two steps: fill in, then confirm. */
export function AddSpecies({
  species,
  person,
  onClose,
  onAdded,
  initialName = "",
}: {
  species: Species[];
  person: Person;
  initialName?: string; // e.g. what was typed in the label combo box
  onClose: () => void;
  onAdded: (list: Species[], added?: Species) => void;
}) {
  const [form, setForm] = useState({
    common: initialName,
    scientific: "",
    status: "native" as SpeciesStatus,
    habitat: "Marine",
    kind: "fish" as Species["kind"],
  });
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const dup = species.find((s) => form.common.trim() && norm(s.common) === norm(form.common));
  const save = async () => {
    try {
      const list = await api.species.add({
        ...form,
        common: form.common.trim(),
        scientific: form.scientific.trim() || "—",
        addedBy: person.name,
      });
      onAdded(
        list,
        list.find((s) => norm(s.common) === norm(form.common)),
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setConfirming(false);
    }
  };
  return (
    <Modal
      title={confirming ? "Add this species?" : "Add a new species"}
      onClose={onClose}
      footer={
        confirming ? (
          <>
            <button className={btnGhost} onClick={() => setConfirming(false)}>
              Back
            </button>
            <button className={btnPrimary} onClick={save}>
              Yes, add it
            </button>
          </>
        ) : (
          <>
            <button className={btnGhost} onClick={onClose}>
              Cancel
            </button>
            <button className={btnPrimary} disabled={!form.common.trim() || !!dup} onClick={() => setConfirming(true)}>
              Next
            </button>
          </>
        )
      }
    >
      {confirming ? (
        <p className="text-sm">
          <b>{form.common.trim()}</b>
          {form.scientific.trim() && <i> ({form.scientific.trim()})</i>} will be added to the Species Registry as{" "}
          {form.kind === "invertebrate" ? "an invertebrate" : "a fish"}, status <b>{form.status}</b>. Everyone using
          this computer will see it.
        </p>
      ) : (
        <div className="space-y-4">
          <Field label="Common name">
            <input
              className="input"
              value={form.common}
              onChange={(e) => setForm({ ...form, common: e.target.value })}
              placeholder="e.g. Black sea bass"
            />
          </Field>
          {dup && <p className="-mt-2 text-sm text-warning-ink">“{dup.common}” is already in the list.</p>}
          <Field label="Scientific name (optional)">
            <input
              className="input"
              value={form.scientific}
              onChange={(e) => setForm({ ...form, scientific: e.target.value })}
              placeholder="e.g. Centropristis striata"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Group">
              <select
                className="input"
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as Species["kind"] })}
              >
                <option value="fish">Fish</option>
                <option value="invertebrate">Invertebrate</option>
              </select>
            </Field>
            <Field label="Status">
              <select
                className="input"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as SpeciesStatus })}
              >
                <option value="native">Native</option>
                <option value="invasive">Invasive</option>
                <option value="unusual">Unusual visitor</option>
              </select>
            </Field>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

const QUALITY: Record<string, string> = {
  clear: "Clear",
  moderate: "Moderate",
  muddy: "Muddy",
  obscured: "Too murky to identify fish",
};

/** How clear this picture is (quality filter) and whether its boxes were carried over (static picture). */
function PictureQuality({ frame }: { frame: Frame }) {
  return (
    <>
      {frame.quality && (
        <span
          title={frame.qualityReasons || undefined}
          className={frame.quality === "obscured" || frame.quality === "muddy" ? "text-warning-ink" : ""}
        >
          · {QUALITY[frame.quality] ?? frame.quality}
        </span>
      )}
      {frame.static && <span title="Same as the previous picture: its boxes were carried over">· static</span>}
    </>
  );
}
