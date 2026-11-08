"""Species identification: BioCLIP 2 on detection crops, matched against the species list (registry).

How it works (no retraining needed):
- Staff add reference pictures to species in the registry. Each picture is turned into a BioCLIP 2
  embedding once and stored (`encode`).
- For a tracked fish, its best crops are embedded and compared with every reference (cosine
  similarity). Each species' score = the mean over the fish's crops of its closest reference.
- Rules (thresholds in config/app.yaml, `species.*`). With reference pictures for only one species,
  a fish is never named automatically (only suggested): there's nothing to compare it against.
    best ≥ match_threshold and ahead of the next species by ≥ margin  → that species
    best < novelty_threshold (far from everything in the registry)    → "Potential Novel Sighting"
    otherwise                                                         → "Unknown"
  Similarity is not a probability. The top suggestions are always shown so staff can pick.

Species ID runs on crops only, never whole pictures (CLAUDE.md, Coding conventions). It never
labels anything "invasive" or "unusual"; a species' status is a human note in the registry.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

import cv2
import numpy as np

from .config import SpeciesConfig
from .detect import ModelMissingError
from .device import GPU_LOCK, torch_device

log = logging.getLogger(__name__)

UNKNOWN = "Unknown"
NOVEL = "Potential Novel Sighting"


@dataclass
class SpeciesResult:
    top_k: list[tuple[str, float]]  # (registry species id, score), best first
    novelty: float  # 1 – best similarity: distance to the nearest registry species
    label: str  # registry species id | "Unknown" | "Potential Novel Sighting"
    reason: str = ""  # why it is unknown, in plain English (shown to staff)


@dataclass
class ReferenceIndex:
    """Reference embeddings of the registry, grouped by species id."""

    by_species: dict[str, np.ndarray] = field(default_factory=dict)

    @classmethod
    def build(cls, refs: list[tuple[str, np.ndarray]]) -> "ReferenceIndex":
        grouped: dict[str, list[np.ndarray]] = {}
        for species_id, vec in refs:
            grouped.setdefault(species_id, []).append(np.asarray(vec, dtype=np.float32))
        return cls({k: np.stack(v) for k, v in grouped.items()})

    @property
    def empty(self) -> bool:
        return not self.by_species


REFERENCE_MAX_WIDTH = 1024


def prepare_reference(img: np.ndarray) -> np.ndarray:
    """A reference picture as it is stored and fingerprinted: at most 1024 px wide."""
    h, w = img.shape[:2]
    if w > REFERENCE_MAX_WIDTH:
        img = cv2.resize(img, (REFERENCE_MAX_WIDTH, round(h * REFERENCE_MAX_WIDTH / w)), interpolation=cv2.INTER_AREA)
    return img


def crop_box(image_bgr: np.ndarray, box: tuple[float, float, float, float], padding: float,
             min_px: float) -> np.ndarray | None:
    """Cut a padded crop around a box; None when it is too small to identify."""
    h, w = image_bgr.shape[:2]
    x1, y1, x2, y2 = box
    if x2 - x1 < min_px or y2 - y1 < min_px:
        return None
    px, py = (x2 - x1) * padding, (y2 - y1) * padding
    xa, ya = int(max(0, x1 - px)), int(max(0, y1 - py))
    xb, yb = int(min(w, x2 + px)), int(min(h, y2 + py))
    if xb - xa < 2 or yb - ya < 2:
        return None
    return image_bgr[ya:yb, xa:xb].copy()


def match(crop_vectors: np.ndarray, index: ReferenceIndex, cfg: SpeciesConfig) -> SpeciesResult:
    """Match one fish (one or more crop embeddings) against the registry references."""
    if index.empty:
        return SpeciesResult([], 1.0, UNKNOWN, "No species has reference pictures yet.")
    if crop_vectors.size == 0:
        return SpeciesResult([], 1.0, UNKNOWN, "The fish is too small or blurred to identify.")
    scores = {sid: float((crop_vectors @ refs.T).max(axis=1).mean()) for sid, refs in index.by_species.items()}
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    top = [(sid, round(s, 3)) for sid, s in ranked[: cfg.top_k]]
    best = ranked[0][1]
    second = ranked[1][1] if len(ranked) > 1 else -1.0
    novelty = round(1.0 - best, 3)
    if len(ranked) < 2 and best >= cfg.novelty_threshold:
        # BioCLIP finds most fish fairly similar to each other, so one species alone can't be told apart
        # from "some other fish". Suggest it, but never fill it in (conservative counting).
        return SpeciesResult(top, novelty, UNKNOWN, "Only one species has reference pictures, so the AI can't "
                                                    "compare. Add pictures of other species too.")
    if best >= cfg.match_threshold and best - second >= cfg.margin:
        return SpeciesResult(top, novelty, ranked[0][0])
    if best < cfg.novelty_threshold:
        return SpeciesResult(top, novelty, NOVEL, "It doesn't look like any species in the list.")
    if best >= cfg.match_threshold:
        return SpeciesResult(top, novelty, UNKNOWN, "Two or more species look equally likely.")
    return SpeciesResult(top, novelty, UNKNOWN, "Not similar enough to any species to be sure.")


class BioClipEncoder:
    """BioCLIP 2 image encoder (open_clip), loaded once from the local models folder."""

    name = "BioCLIP 2"

    def __init__(self, cfg: SpeciesConfig):
        self.cfg = cfg
        self.device = torch_device()
        self.model = None
        self.preprocess = None
        self.dim: int | None = None

    @property
    def available(self) -> bool:
        return (self.cfg.model_dir / "open_clip_config.json").is_file()

    def load(self) -> "BioClipEncoder":
        if self.model is not None:
            return self
        if not self.available:
            raise ModelMissingError(f"The species model (BioCLIP 2) is missing from {self.cfg.model_dir}. "
                                    "Ask the integration team to put the model files in the models folder.")
        import open_clip
        import torch
        with GPU_LOCK:
            model, _, preprocess = open_clip.create_model_and_transforms(f"local-dir:{self.cfg.model_dir.as_posix()}")
            model.eval().to(self.device)
            if self.device == "cuda":
                model = model.half()  # fp16 keeps BioCLIP 2 at ~1.7 GB of GPU memory
            self.model, self.preprocess = model, preprocess
            with torch.no_grad():
                from PIL import Image
                dummy = preprocess(Image.new("RGB", (224, 224))).unsqueeze(0).to(self.device)
                self.dim = int(model.encode_image(dummy.half() if self.device == "cuda" else dummy).shape[-1])
        log.info("Loaded BioCLIP 2 from %s on %s (dim %s)", self.cfg.model_dir, self.device, self.dim)
        return self

    def encode(self, crops_bgr: list[np.ndarray], batch_size: int = 16) -> np.ndarray:
        """L2-normalised float32 embeddings, one row per crop."""
        self.load()
        if not crops_bgr:
            return np.zeros((0, self.dim or 0), np.float32)
        import torch
        from PIL import Image
        out = []
        for i in range(0, len(crops_bgr), batch_size):
            batch = torch.stack([self.preprocess(Image.fromarray(cv2.cvtColor(c, cv2.COLOR_BGR2RGB)))
                                 for c in crops_bgr[i:i + batch_size]]).to(self.device)
            with GPU_LOCK, torch.no_grad():
                feats = self.model.encode_image(batch.half() if self.device == "cuda" else batch).float()
            out.append(torch.nn.functional.normalize(feats, dim=-1).cpu().numpy().astype(np.float32))
        return np.concatenate(out)
