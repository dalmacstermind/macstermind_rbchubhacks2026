"""GPU / CPU choice, made once at start-up (CLAUDE.md, Target hardware).

The CUDA build of PyTorch also runs on CPU, so one package covers both: if no NVIDIA GPU is
usable, everything runs on the CPU (slower) and the UI shows "CPU mode".

GPU_LOCK: the detector runs in the analysis thread while species reference images can be added
from a request at the same time. Running two models on one small GPU at once crashed the process
natively in testing, so all model loading and inference goes through this one lock.
"""
import threading
from functools import lru_cache

GPU_LOCK = threading.RLock()


@lru_cache(maxsize=1)
def torch_device() -> str:
    """"cuda" when an NVIDIA GPU is usable, otherwise "cpu". PyTorch missing also means "cpu"."""
    try:
        import torch
    except ImportError:
        return "cpu"
    return "cuda" if torch.cuda.is_available() else "cpu"


def mode() -> str:
    """"gpu" or "cpu", as shown in the UI ("GPU mode" / "CPU mode")."""
    return "gpu" if torch_device() == "cuda" else "cpu"


def gpu_name() -> str | None:
    if torch_device() != "cuda":
        return None
    import torch
    return torch.cuda.get_device_name(0)
