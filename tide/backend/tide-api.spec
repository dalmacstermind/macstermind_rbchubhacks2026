# PyInstaller recipe for the packaged back end: dist/tide-api/tide-api.exe (one folder, not one file,
# so it starts quickly and the models aren't unpacked on every start).
#
#   cd backend
#   .venv\Scripts\activate
#   pyinstaller tide-api.spec --noconfirm
#
# Build from a clean virtual environment (pip install -r requirements-dev.txt): PyInstaller bundles
# whatever is installed. electron-builder then copies dist/tide-api into the installer
# (app/electron-builder.yml, extraResources).
#
# Layout inside dist/tide-api/_internal/ (sys._MEIPASS):
#   config/   app.yaml, protocol.yaml, reference_seed.json  (tide/config.py, default_config_dir)
#   models/   detector, BioCLIP 2, reference seed           (app.yaml models.dir = ../models)
from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

datas = [
    ("config", "config"),
    ("models", "models"),
]
binaries = []
hiddenimports = []

# FFmpeg for context clips (README, "Notes for the integration team"). GPL-3.0: see docs/LICENCES.md.
datas += collect_data_files("imageio_ffmpeg", subdir="binaries")

# Packages imported lazily inside functions, or that read their own data files (model configs,
# tokenizer vocab) at runtime. collect_all takes their code, data files and binaries.
for package in ("open_clip", "rfdetr", "trackers", "supervision", "timm"):
    d, b, h = collect_all(package)
    datas += d
    binaries += b
    hiddenimports += h

# transformers loads its submodules lazily by name, so static analysis misses most of them.
hiddenimports += collect_submodules("transformers.models.auto")
datas += collect_data_files("transformers")

# uvicorn picks its event loop and protocol classes by name at runtime.
hiddenimports += collect_submodules("uvicorn")

a = Analysis(
    ["run.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Developer and test-only tools that would only make the app bigger.
    excludes=["pytest", "tkinter", "matplotlib.tests", "IPython", "jupyter", "notebook"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="tide-api",
    debug=False,
    strip=False,
    upx=False,  # UPX-packed PyTorch DLLs break, and antivirus flags UPX more often
    # A console program: the desktop app starts it with windowsHide (no window shows) and reads its
    # output to show a plain message if it crashes. A windowless build has no stdout/stderr, which
    # makes progress bars inside rfdetr/transformers crash.
    console=True,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="tide-api",
)
