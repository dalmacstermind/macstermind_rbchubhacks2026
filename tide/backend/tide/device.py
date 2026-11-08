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


@lru_cache(maxsize=1)
def half_is_fast() -> bool:
    """Whether this GPU runs half precision (fp16) faster than full precision (fp32).

    Cards with tensor cores (RTX and newer) are much faster in fp16. Some cards without them,
    like the GTX 1650 Ti, are ~4x SLOWER in fp16, which made species ID take minutes per video.
    Measured once with a short matrix multiply; never fp16 on the CPU.
    """
    if torch_device() != "cuda":
        return False
    import time

    import torch
    try:
        with GPU_LOCK:
            x = torch.randn(1024, 1024, device="cuda")
            speed = {}
            for dt in (torch.float32, torch.float16):
                y = x.to(dt)
                y @ y  # warm-up
                torch.cuda.synchronize()
                t = time.perf_counter()
                for _ in range(20):
                    y @ y
                torch.cuda.synchronize()
                speed[dt] = time.perf_counter() - t
            del x, y
        return speed[torch.float16] < speed[torch.float32]
    except Exception:  # a failed check keeps the safe choice
        return False
