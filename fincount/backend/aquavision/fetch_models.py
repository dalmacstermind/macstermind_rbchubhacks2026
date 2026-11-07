"""Developer tool: put the model weights into the models folder, ONCE, before running or packaging.

    python -m aquavision.fetch_models               # download (needs internet, developers only)
    python -m aquavision.fetch_models --verify      # only check what's there

The app itself never downloads anything (CLAUDE.md, hard constraint 1): it only loads these files
from disk. Every file is pinned (release / commit) and checked by SHA-256 after download.

Files (see docs/LICENCES.md):
- Community Fish Detector, RF-DETR Medium 1024, release 2026.07.06  → models/cfd/
- BioCLIP 2 (imageomics/bioclip-2) at a pinned commit, open_clip format → models/bioclip-2/
"""
from __future__ import annotations

import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

from .config import load_vision_config

CFD_RELEASE = "2026.07.06-release"
CFD_FILE = "cfd-rf-detr-medium-1024-2026.03.24.cp-011.20260706-release.pth"
CFD_URL = f"https://github.com/filippovarini/community-fish-detector/releases/download/{CFD_RELEASE}/{CFD_FILE}"

BIOCLIP_REPO = "imageomics/bioclip-2"
BIOCLIP_REVISION = "2957b322090f9cb17ae72c71981c7218a28d81e0"
BIOCLIP_FILES = ("open_clip_config.json", "open_clip_model.safetensors", "tokenizer.json", "tokenizer_config.json",
                 "special_tokens_map.json", "vocab.json", "merges.txt", "README.md")

# SHA-256 of the exact files tested with this code. A mismatch means a different file: stop.
SHA256 = {
    CFD_FILE: "2e94814c7a9318aa2e98e5f6b866ceebe0b5b8f92e6fccb912e7e334a7913911",
    "open_clip_model.safetensors": "b7b2bf6fbc95799e42630e394cf95803892ab447c1a8ab629dbc82fbeaf7dfef",
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _download(url: str, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(dst.suffix + ".part")
    print(f"downloading {url}")
    urllib.request.urlretrieve(url, tmp)
    expected = SHA256.get(dst.name)
    if expected and sha256(tmp) != expected:
        tmp.unlink()
        sys.exit(f"{dst.name}: checksum mismatch, not saved.")
    tmp.replace(dst)


def fetch(verify_only: bool = False) -> int:
    cfg = load_vision_config()
    cfd = cfg.detect.checkpoint
    bio = cfg.species.model_dir
    missing = 0
    if cfd.is_file():
        ok = sha256(cfd) == SHA256[CFD_FILE]
        print(f"{'ok ' if ok else 'BAD'}  {cfd}")
        missing += 0 if ok else 1
    elif verify_only:
        print(f"MISSING {cfd}")
        missing += 1
    else:
        _download(CFD_URL, cfd)
    for name in BIOCLIP_FILES:
        p = bio / name
        if p.is_file():
            ok = SHA256.get(name) is None or sha256(p) == SHA256[name]
            print(f"{'ok ' if ok else 'BAD'}  {p}")
            missing += 0 if ok else 1
        elif verify_only:
            print(f"MISSING {p}")
            missing += 1
        else:
            _download(f"https://huggingface.co/{BIOCLIP_REPO}/resolve/{BIOCLIP_REVISION}/{name}", p)
    if not verify_only:
        (bio / "REVISION").write_text(f"{BIOCLIP_REPO}@{BIOCLIP_REVISION}\n", encoding="utf-8")
    return missing


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--verify", action="store_true", help="only check the files, download nothing")
    sys.exit(1 if fetch(ap.parse_args().verify) else 0)
