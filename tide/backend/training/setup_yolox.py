"""Developer tool: fetch the pinned YOLOX source, starting weights and training-only packages, once.

    python -m training.setup_yolox

Everything goes in training/third_party (git-ignored), not the app's environment, so PyInstaller never
bundles it. Weights are checked by SHA-256. The app itself never downloads anything.
"""
from __future__ import annotations

import hashlib
import subprocess
import sys
import urllib.request
from pathlib import Path

from .common import DEPS, HERE, WEIGHTS, YOLOX_SRC

YOLOX_TAG = "0.3.0"
BASE = "https://github.com/Megvii-BaseDetection/YOLOX"
SHA256 = {
    "yolox_s.pth": "f55ded7181e1b0c13285c56e7790b8f0e8f8db590fe4edb37f0b7f345c913a30",
    "yolox_m.pth": "60076992b32da82951c90cfa7bd6ab70eba9eda243e08b940a396f60ac2d19b6",
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    if not YOLOX_SRC.is_dir():
        subprocess.run(["git", "clone", "--depth", "1", "--branch", YOLOX_TAG, f"{BASE}.git", str(YOLOX_SRC)], check=True)
    WEIGHTS.mkdir(parents=True, exist_ok=True)
    for name, expected in SHA256.items():
        path = WEIGHTS / name
        if not path.is_file():
            print(f"downloading {name}")
            urllib.request.urlretrieve(f"{BASE}/releases/download/0.1.1rc0/{name}", path)
        if sha256(path) != expected:
            path.unlink()
            sys.exit(f"{name}: checksum mismatch, removed.")
        print(f"ok  {name}")
    pip = [sys.executable, "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--target", str(DEPS)]
    subprocess.run([*pip, "-r", str(HERE / "requirements-train.txt")], check=True)
    # thop declares torch as a dependency; --no-deps stops pip putting a second torch in third_party.
    subprocess.run([*pip, "--no-deps", "thop==0.1.1.post2209072238"], check=True)
    print("YOLOX is ready.")


if __name__ == "__main__":
    main()
