"""Human labels on tracked organisms (CLAUDE.md, "Labelling unknown fish").

The label picker sends one of these actions (values map one-to-one to `FishLabel.action`):
    species         a registry species (fish or invertebrate species in the list)
    unidentifiable  keep as "Unknown/Unable to ID due to visibility" (marked reviewed)
    not_organism    not a fish / not an organism: removed from all counts
    invertebrate    moved from fish to the invertebrate count (type: crab, shrimp, worm, snail)

The AI's result is never overwritten: labels are separate rows, every label can be undone, and a
human label always wins over the AI when counting.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from .count import TrackLabel

ACTIONS = ("species", "unidentifiable", "not_organism", "invertebrate")
INVERTEBRATE_TYPES = ("crab", "shrimp", "worm", "snail")
UNKNOWN_ID = "unknown"  # registry id used for unidentified fish
NOT_FISH_ID = "not_fish"


@dataclass
class FishLabel:
    label_id: str
    batch_id: str
    track_id: str
    action: str  # "species" | "unidentifiable" | "not_organism" | "invertebrate"
    box: tuple[float, float, float, float] | None  # set when the user drew or corrected the box
    box_source: str  # "ai" | "ai_corrected" | "human_drawn"
    frame_idx: int | None  # frame the human box was drawn on
    species: str | None  # registry species id when action == "species"
    invertebrate_type: str | None
    ai_label: str  # what the AI said ("Unknown" | "Potential Novel Sighting" | species id)
    ai_top_k: list[tuple[str, float]]
    use_as_reference: bool
    labelled_by: str
    labelled_at: datetime


def check_label(action: str, species: str | None, invertebrate_type: str | None, registry: dict[str, str]) -> None:
    """Labels are chosen, never typed: they must match the registry or a fixed option. Raises ValueError."""
    if action not in ACTIONS:
        raise ValueError(f"Unknown label action “{action}”.")
    if action == "species" and (not species or species not in registry or species == UNKNOWN_ID):
        raise ValueError("Choose a species from the species list.")
    if action == "invertebrate" and invertebrate_type not in (None, *INVERTEBRATE_TYPES):
        raise ValueError(f"Invertebrate type must be one of: {', '.join(INVERTEBRATE_TYPES)}.")


def mirror_species_id(action: str, species: str | None) -> str:
    """What the label shows as on each picture in "Check the fish"."""
    if action == "species":
        return species or UNKNOWN_ID
    if action == "not_organism":
        return NOT_FISH_ID
    return UNKNOWN_ID


def label_to_track(action: str, species: str | None, registry: dict[str, str]) -> TrackLabel:
    if action == "species":
        return TrackLabel(registry.get(species, "fish"), species, True)
    if action == "not_organism":
        return TrackLabel("not_organism", None, True)
    if action == "invertebrate":
        return TrackLabel("invertebrate", None, True)
    return TrackLabel("fish", None, True)  # unidentifiable


def effective_labels(detections: list[dict], labels: list[dict], registry: dict[str, str]) -> dict[str, TrackLabel]:
    """What each tracked organism is: a staff label, else a person's check in "Check the fish", else the AI.

    detections: rows with track_id, species_id, model_species_id, verified (later rows win).
    labels: active label rows (track_id, action, species). registry: species id → kind.
    """
    out: dict[str, TrackLabel] = {}
    for d in detections:
        tid = d["track_id"]
        if not tid:
            continue
        if d["verified"]:
            sp = d["species_id"]
            if sp == NOT_FISH_ID:
                out[tid] = TrackLabel("not_organism", None, True)
            elif sp == UNKNOWN_ID or sp not in registry:
                out[tid] = TrackLabel("fish", None, True)
            else:
                out[tid] = TrackLabel(registry[sp], sp, True)
        elif tid not in out or not out[tid].human:
            sp = d["model_species_id"]
            named = sp if sp in registry and sp != UNKNOWN_ID else None
            out[tid] = TrackLabel(registry.get(named, "fish") if named else "fish", named, False)
    for lab in labels:
        out[lab["track_id"]] = label_to_track(lab["action"], lab["species"], registry)
    return out
