"""Developer tool for the default reference pictures of the Species Registry.

The pictures and their fingerprints are in the repo (Git LFS), so nobody needs to run this to use them.

    python -m tide.fetch_reference_images                 # download any listed photo that's missing
    python -m tide.fetch_reference_images --verify        # only check what's there
    python -m tide.fetch_reference_images --refresh       # pick new photos from iNaturalist, rewrite the list
    python -m tide.fetch_reference_images --fingerprints  # work out their fingerprints (species model)

The app itself never downloads anything (CLAUDE.md, hard constraint 1). On first start it adds the
pictures to the Species Registry (tide_api.pipeline.seed_default_references), using the saved
fingerprints, so it needs neither the internet nor the species model.

Photos come from iNaturalist "research grade" observations (at least two people agreed on the
species), with a CC0 or CC-BY licence only. config/reference_seed.json records, for every photo, the
observation, photographer credit, licence and SHA-256. After --refresh, run --fingerprints and
commit the list, the pictures and fingerprints.npz together.

Most of these photos are taken out of the water; survey footage is murky and underwater. Measure
suggestions with and without them on a held-out video before relying on them (CLAUDE.md, Data and
evaluation rules).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .config import default_config_dir, load_vision_config

MANIFEST = "reference_seed.json"
LICENCES = ("cc0", "cc-by")  # free to use, also commercially; CC-BY needs the credit (kept in the list)
PER_SPECIES = 25
USER_AGENT = "TIDE-reference-fetch/0.1 (developer tool)"
API = "https://api.inaturalist.org/v1/observations"

# Species that ship with TIDE (tide_api.db.DEFAULT_SPECIES), by registry id. "unknown" has no pictures.
SEED_SPECIES = {
    "cod": "Gadus morhua",
    "cunner": "Tautogolabrus adspersus",
    "mackerel": "Scomber scombrus",
    "flounder": "Pseudopleuronectes americanus",
    "trout": "Salvelinus fontinalis",
    "bass": "Micropterus dolomieu",
    "pickerel": "Esox niger",
    "triggerfish": "Balistes capriscus",
    "green_crab": "Carcinus maenas",
}


def manifest_path() -> Path:
    return default_config_dir() / MANIFEST


def load_manifest(path: Path | None = None) -> dict[str, list[dict]]:
    """{species id: [photo entries]} from config/reference_seed.json, or {} if there is none."""
    path = path or manifest_path()
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))["species"]


def pick_photos(observations: list[dict], wanted: int, licences: tuple[str, ...] = LICENCES) -> list[dict]:
    """At most `wanted` photos, one per observation (so they show different fish), CC0/CC-BY only.

    Uses the 500 px "medium" size: enough for the species model, small to download.
    """
    picked: list[dict] = []
    for obs in observations:
        if obs.get("quality_grade") != "research":
            continue
        photo = next((p for p in obs.get("photos", []) if (p.get("license_code") or "") in licences), None)
        if not photo or not photo.get("url"):
            continue
        picked.append({
            "photo_id": photo["id"],
            "observation": f"https://www.inaturalist.org/observations/{obs['id']}",
            "url": photo["url"].replace("/square.", "/medium."),
            "licence": photo["license_code"],
            "credit": photo.get("attribution", ""),
            "file": f"inat-{photo['id']}.jpg",
        })
        if len(picked) >= wanted:
            break
    return picked


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def refresh(wanted: int = PER_SPECIES) -> dict[str, list[dict]]:
    """Ask iNaturalist for new photos for every species and download them (needs internet)."""
    seed_dir = load_vision_config().species.seed_dir
    species: dict[str, list[dict]] = {}
    for sid, scientific in SEED_SPECIES.items():
        query = urllib.parse.urlencode({
            "taxon_name": scientific, "quality_grade": "research", "photos": "true",
            "photo_license": ",".join(LICENCES), "per_page": 100, "order_by": "votes",
        })
        observations = json.loads(_get(f"{API}?{query}"))["results"]
        time.sleep(1.1)  # iNaturalist asks API users to stay around one request per second
        entries = []
        for e in pick_photos(observations, wanted * 2):  # spares, in case a download fails
            try:
                data = _get(e["url"])
            except OSError as err:
                print(f"skipped {e['url']}: {err}")
                continue
            e["sha256"] = _sha256(data)
            _save(seed_dir / sid / e["file"], data)
            entries.append(e)
            if len(entries) >= wanted:
                break
        print(f"{sid}: {len(entries)} photos")
        species[sid] = entries
    manifest_path().write_text(json.dumps({
        "source": "iNaturalist research-grade observations",
        "licences": list(LICENCES),
        "species": species,
    }, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return species


def fetch(verify_only: bool = False) -> int:
    """Download (or check) the photos listed in config/reference_seed.json. Returns how many are bad/missing."""
    seed_dir = load_vision_config().species.seed_dir
    bad = 0
    for sid, entries in load_manifest().items():
        for e in entries:
            dst = seed_dir / sid / e["file"]
            if dst.is_file() and _sha256(dst.read_bytes()) == e["sha256"]:
                continue
            if verify_only:
                print(f"{'BAD' if dst.is_file() else 'MISSING'} {dst}")
                bad += 1
                continue
            data = _get(e["url"])
            if _sha256(data) != e["sha256"]:
                print(f"{dst.name}: checksum mismatch, not saved")
                bad += 1
                continue
            _save(dst, data)
        print(f"{sid}: {len(entries)} photos ok")
    return bad


FINGERPRINTS = "fingerprints.npz"


@dataclass(frozen=True)
class Fingerprints:
    """Species-model fingerprints of the default pictures, worked out once and shipped with them, so
    TIDE can fill the Species Registry on first start without running the model."""
    model: str  # e.g. "BioCLIP 2"
    revision: str  # the exact model version (tide.fetch_models.BIOCLIP_REVISION)
    vectors: dict[int, np.ndarray]  # iNaturalist photo id -> fingerprint


def load_fingerprints(seed_dir: Path) -> Fingerprints | None:
    path = seed_dir / FINGERPRINTS
    if not path.is_file():
        return None
    with np.load(path) as f:
        return Fingerprints(str(f["model"]), str(f["revision"]),
                            {int(pid): vec for pid, vec in zip(f["photo_ids"], f["vectors"])})


def write_fingerprints() -> int:
    """Work out every downloaded picture's fingerprint with the species model and save them (developers,
    after downloading or refreshing the pictures). Returns how many were saved."""
    from .analyse import read_image  # here, so the download alone doesn't need the model's packages
    from .fetch_models import BIOCLIP_REVISION
    from .species import BioClipEncoder, prepare_reference
    cfg = load_vision_config()
    encoder = BioClipEncoder(cfg.species).load()
    ids, vectors = [], []
    for sid, entries in load_manifest().items():
        for e in entries:
            img = prepare_reference(read_image(cfg.species.seed_dir / sid / e["file"]))
            ids.append(e["photo_id"])
            vectors.append(encoder.encode([img])[0])
        print(f"{sid}: {len(entries)} fingerprints")
    np.savez(cfg.species.seed_dir / FINGERPRINTS, model=np.array(encoder.name), revision=np.array(BIOCLIP_REVISION),
             photo_ids=np.array(ids, dtype=np.int64), vectors=np.asarray(vectors, dtype=np.float32))
    return len(ids)


def _save(dst: Path, data: bytes) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(".part")
    tmp.write_bytes(data)
    tmp.replace(dst)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--verify", action="store_true", help="only check the files, download nothing")
    ap.add_argument("--refresh", action="store_true", help="pick new photos from iNaturalist and rewrite the list")
    ap.add_argument("--fingerprints", action="store_true",
                    help="work out the pictures' fingerprints with the species model (after --refresh)")
    args = ap.parse_args()
    if args.refresh:
        refresh()
        sys.exit(0)
    if args.fingerprints:
        print(f"{write_fingerprints()} fingerprints saved")
        sys.exit(0)
    sys.exit(1 if fetch(args.verify) else 0)
