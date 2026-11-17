"""Environment-backed configuration; filesystem paths never depend on cwd."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
MODEL_WEIGHTS_PATH = Path(os.getenv("KAONCHECK_MODEL_PATH", "models/kaoncheck.pt"))
if not MODEL_WEIGHTS_PATH.is_absolute():
    MODEL_WEIGHTS_PATH = BASE_DIR / MODEL_WEIGHTS_PATH
MODEL_WEIGHTS_PATH = MODEL_WEIGHTS_PATH.resolve()

MAX_UPLOAD_BYTES = int(os.getenv("KAONCHECK_MAX_UPLOAD_BYTES", "10485760"))
MAX_IMAGE_PIXELS = int(os.getenv("KAONCHECK_MAX_IMAGE_PIXELS", "20000000"))
CONFIDENCE = float(os.getenv("KAONCHECK_CONFIDENCE", "0.25"))
if MAX_UPLOAD_BYTES <= 0 or MAX_IMAGE_PIXELS <= 0 or not 0 < CONFIDENCE <= 1:
    raise ValueError("Upload/image limits must be positive and confidence must be in (0, 1]")
