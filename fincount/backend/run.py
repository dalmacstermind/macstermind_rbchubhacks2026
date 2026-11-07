"""Entry point for the packaged back end (fincount-api.exe). The desktop app runs:

    fincount-api.exe --port 51234 --data-dir "C:\\Users\\<name>\\AppData\\Roaming\\FinCount"

with FINCOUNT_TOKEN set in the environment. For development, run instead:

    uvicorn fincount_api.main:app --port 8765 --reload
"""
import argparse
import os
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=8765)
parser.add_argument("--data-dir", default=None)
args = parser.parse_args()
if args.data_dir:
    os.environ["FINCOUNT_DATA_DIR"] = args.data_dir

import uvicorn  # noqa: E402

from fincount_api.main import app  # noqa: E402  (import after FINCOUNT_DATA_DIR is set)

if __name__ == "__main__":
    # Only this computer can connect. log_config=None keeps PyInstaller's windowless .exe happy.
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_config=None)
    sys.exit(0)
