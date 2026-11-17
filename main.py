import os

# Never install optional model dependencies while handling a request.
os.environ["YOLO_AUTOINSTALL"] = "false"

from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pathlib import Path
from contextlib import asynccontextmanager
import hashlib
import logging
from ultralytics import YOLO
from nlp import get_quick_advisory, stream_nutrition_reply, get_yobab_reply
import csv
import json
import time
import io
import warnings
from threading import Lock
from PIL import Image, UnidentifiedImageError
from request_limits import RequestLimitMiddleware

BASE_DIR = Path(__file__).resolve().parent
MODEL_RUN_DIR = BASE_DIR / "runs/detect/kaoncheck-4"
MODEL_WEIGHTS_PATH = Path(os.getenv("KAONCHECK_MODEL_PATH", "models/kaoncheck.pt"))
if not MODEL_WEIGHTS_PATH.is_absolute():
    MODEL_WEIGHTS_PATH = BASE_DIR / MODEL_WEIGHTS_PATH
model = None
logger = logging.getLogger(__name__)
MAX_UPLOAD_BYTES = int(os.getenv("KAONCHECK_MAX_UPLOAD_BYTES", "10485760"))
MAX_IMAGE_PIXELS = int(os.getenv("KAONCHECK_MAX_IMAGE_PIXELS", "20000000"))
CONFIDENCE = float(os.getenv("KAONCHECK_CONFIDENCE", "0.25"))
if MAX_UPLOAD_BYTES <= 0 or MAX_IMAGE_PIXELS <= 0 or not 0 < CONFIDENCE <= 1:
    raise ValueError("Invalid upload, image, or confidence configuration")
inference_lock = Lock()


def load_detector():
    if not MODEL_WEIGHTS_PATH.is_file():
        raise FileNotFoundError("Model checkpoint missing")
    if MODEL_WEIGHTS_PATH == BASE_DIR / "models/kaoncheck.pt":
        expected = (BASE_DIR / "models/kaoncheck.sha256").read_text().split()[0]
        if hashlib.sha256(MODEL_WEIGHTS_PATH.read_bytes()).hexdigest() != expected:
            raise ValueError("Model checkpoint checksum mismatch")
    return YOLO(str(MODEL_WEIGHTS_PATH))


@asynccontextmanager
async def lifespan(app):
    global model
    try:
        model = load_detector()
    except Exception:
        model = None
        logger.exception("Detector initialization failed")
    yield
    model = None


app = FastAPI(lifespan=lifespan)
app.add_middleware(RequestLimitMiddleware, max_bytes=MAX_UPLOAD_BYTES + 65536)


@app.get("/health/ready")
def readiness():
    if model is None:
        raise HTTPException(503, "Detector unavailable; check model configuration and server logs")
    return {"ready": True, "model": "YOLOv8n", "classes": len(model.names)}

@app.post("/analyze")
def analyze(file: UploadFile = File(...)):
    if model is None:
        raise HTTPException(503, "Detector unavailable; check /health/ready")
    try:
        payload = file.file.read(MAX_UPLOAD_BYTES + 1)
    finally:
        file.file.close()
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Image exceeds the upload size limit")
    if not payload:
        raise HTTPException(422, "Image is empty")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(payload), formats=["JPEG", "PNG", "WEBP", "GIF"]) as source:
                if source.format not in {"JPEG", "PNG", "WEBP"}:
                    raise HTTPException(415, "Use a JPEG, PNG, or WebP image")
                if source.width * source.height > MAX_IMAGE_PIXELS:
                    raise HTTPException(413, "Image exceeds the pixel limit")
                source.load()
                image = source.convert("RGB")
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(413, "Image exceeds the decoder safety limit") from None
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(422, "Cannot decode image; use a valid JPEG, PNG, or WebP") from None

    if not inference_lock.acquire(blocking=False):
        image.close()
        raise HTTPException(429, "Detector busy; try again shortly", headers={"Retry-After": "1"})
    try:
        started_at = time.perf_counter()
        results = model(image, conf=CONFIDENCE, verbose=False)
        inference_ms = round((time.perf_counter() - started_at) * 1000, 1)
    except Exception:
        logger.exception("Image inference failed")
        raise HTTPException(500, "Image analysis failed; please try again") from None
    finally:
        inference_lock.release()
        image.close()

    detections = []
    seen = set()
    for result in results:
        for box in result.boxes:
            class_id = int(box.cls[0])
            dish_name = model.names[class_id]
            if dish_name in seen:
                continue
            seen.add(dish_name)
            confidence = float(box.conf[0])
            bbox = box.xyxyn[0].tolist()
            advisory = get_quick_advisory(dish_name)
            detections.append({
                "dish": dish_name,
                "confidence": round(confidence * 100, 1),
                "bbox": bbox,
                "advisory": advisory
            })

    if not detections:
        return {
            "message": "No dish detected",
            "detections": [],
            "inference_ms": inference_ms,
            "model": "YOLOv8n",
        }

    return {
        "detections": detections,
        "inference_ms": inference_ms,
        "model": "YOLOv8n",
    }


@app.get("/model-metrics")
async def model_metrics():
    metrics_path = os.path.join(MODEL_RUN_DIR, "results.csv")
    latest = {}

    if os.path.exists(metrics_path):
        with open(metrics_path, newline="", encoding="utf-8") as csv_file:
            rows = list(csv.DictReader(csv_file))
            if rows:
                latest = {key.strip(): value for key, value in rows[-1].items()}

    def read_float(key, fallback=0.0):
        try:
            return float(latest.get(key, fallback))
        except (TypeError, ValueError):
            return fallback

    precision = read_float("metrics/precision(B)")
    recall = read_float("metrics/recall(B)")
    f1_score = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0

    return {
        "model": "YOLOv8n",
        "weights": MODEL_WEIGHTS_PATH,
        "run": "kaoncheck-4",
        "epochs": int(read_float("epoch")),
        "validation_metrics": {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1_score": round(f1_score, 4),
            "map50": round(read_float("metrics/mAP50(B)"), 4),
            "map50_95": round(read_float("metrics/mAP50-95(B)"), 4),
        },
        "charts": [
            {"label": "Training results", "url": "/static/runs/detect/kaoncheck-4/results.png"},
            {"label": "F1 curve", "url": "/static/runs/detect/kaoncheck-4/BoxF1_curve.png"},
            {"label": "Precision-recall curve", "url": "/static/runs/detect/kaoncheck-4/BoxPR_curve.png"},
            {"label": "Confusion matrix", "url": "/static/runs/detect/kaoncheck-4/confusion_matrix.png"},
        ],
        "note": "Precision, recall, F1, and mAP are validation-set metrics, not per-upload scores.",
    }


def validate_history(history):
    from nlp import _parse_history
    try:
        return _parse_history(history)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@app.post("/advisor/stream")
async def advisor_stream(
    dish: str = Form(..., min_length=1, max_length=100),
    question: str = Form("", max_length=2000),
    history: str = Form("", max_length=16000)
):
    validate_history(history)
    # Validate before sending stream headers.
    # This one handles the real-time chat streaming
    return StreamingResponse(
        stream_nutrition_reply(dish, question, history),
        media_type="text/plain; charset=utf-8",
    )


@app.post("/advisor/reply")
def advisor_reply(
    dish: str = Form(..., min_length=1, max_length=100),
    question: str = Form("", max_length=2000),
    history: str = Form("", max_length=16000),
    meal_context: str = Form("", max_length=4000),
):
    parsed_history = validate_history(history)
    if meal_context:
        try:
            parsed = json.loads(meal_context)
            if not isinstance(parsed, dict):
                raise ValueError()
        except (json.JSONDecodeError, ValueError):
            raise HTTPException(422, "meal_context must be a JSON object") from None
    # Client-supplied nutrition claims are not trusted as model context.
    parsed_meal = {"food_name": dish}

    reply = get_yobab_reply(question, parsed_history, parsed_meal)
    return {"reply": reply}


PUBLIC_FILES = {
    "app.js": BASE_DIR / "app.js",
    "styles.css": BASE_DIR / "styles.css",
    "runs/detect/kaoncheck-4/results.png": BASE_DIR / "docs/results/training-results.png",
    "runs/detect/kaoncheck-4/BoxPR_curve.png": BASE_DIR / "docs/results/precision-recall-curve.png",
    "runs/detect/kaoncheck-4/confusion_matrix.png": BASE_DIR / "docs/results/confusion-matrix.png",
}


@app.get("/static/{path:path}")
def public_file(path: str):
    target = PUBLIC_FILES.get(path)
    if target is None or not target.is_file():
        raise HTTPException(404, "Asset not found")
    return FileResponse(target)

@app.get("/")
async def read_index():
    return FileResponse(BASE_DIR / 'index.html')
