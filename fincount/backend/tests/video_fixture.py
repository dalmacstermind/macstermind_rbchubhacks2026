"""Builds a small synthetic test video, so no real survey media is ever committed.

Each frame shows a moving rectangle, its frame number as text, and the frame number again as a
strip of black/white blocks along the top. decode_index() reads the strip back, so a test can
tell exactly which frame the reader returned (and catch seeking that lands on the wrong frame).
"""
from pathlib import Path

import cv2
import numpy as np

WIDTH, HEIGHT = 160, 120
BITS = 12          # enough for 4096 frames
BLOCK_H = 16


def make_video(path: Path, seconds: int = 180, fps: int = 10) -> Path:
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (WIDTH, HEIGHT))
    assert writer.isOpened(), "OpenCV can't write mp4v on this machine"
    for i in range(seconds * fps):
        img = np.full((HEIGHT, WIDTH, 3), 90, np.uint8)
        x = 10 + (i * 3) % (WIDTH - 50)  # moving rectangle
        cv2.rectangle(img, (x, 60), (x + 30, 90), (40, 180, 220), -1)
        cv2.putText(img, str(i), (4, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
        block_w = WIDTH // BITS
        for b in range(BITS):
            on = (i >> (BITS - 1 - b)) & 1
            img[:BLOCK_H, b * block_w:(b + 1) * block_w] = 255 if on else 0
        writer.write(img)
    writer.release()
    return path


def decode_index(image: np.ndarray) -> int:
    """Read the frame number back from the block strip."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    block_w = gray.shape[1] // BITS
    value = 0
    for b in range(BITS):
        cell = gray[3:BLOCK_H - 3, b * block_w + 3:(b + 1) * block_w - 3]
        value = (value << 1) | int(cell.mean() > 127)
    return value
