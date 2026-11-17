"""FastAPI routes for the local, upload-only food detector."""
from contextlib import asynccontextmanager
import hashlib
import io
import json
import logging
import os
from threading import Lock
import time
import warnings

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError

from dishes import DISHES, preparation_notes, canonical_food_name
from request_limits import RequestLimitMiddleware
from settings import BASE_DIR, MODEL_WEIGHTS_PATH, MAX_UPLOAD_BYTES, MAX_IMAGE_PIXELS, CONFIDENCE

model = None
logger = logging.getLogger(__name__)
inference_lock = Lock()


def load_detector():
    if not MODEL_WEIGHTS_PATH.is_file():
        raise FileNotFoundError("Model checkpoint missing")
    if MODEL_WEIGHTS_PATH == BASE_DIR / "models/kaoncheck.pt":
        expected = (BASE_DIR / "models/kaoncheck.sha256").read_text().split()[0]
        if hashlib.sha256(MODEL_WEIGHTS_PATH.read_bytes()).hexdigest() != expected:
            raise ValueError("Model checkpoint checksum mismatch")
    # Ultralytics reads this on import; serving must never install optional packages.
    os.environ["YOLO_AUTOINSTALL"] = "false"
    from ultralytics import YOLO
    detector = YOLO(str(MODEL_WEIGHTS_PATH))
    names = {canonical_food_name(name).lower() for name in detector.names.values()}
    if names != set(DISHES) or len(detector.names) != len(DISHES):
        raise ValueError("Checkpoint must contain the 11 supported food classes")
    return detector


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
    return {"ready": True, "model": "YOLOv8n", "classes": len(model.names), "max_upload_bytes": MAX_UPLOAD_BYTES}

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
                image = ImageOps.exif_transpose(source).convert("RGB")
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
    for result in results:
        for box in result.boxes:
            class_id = int(box.cls[0])
            dish_name = canonical_food_name(model.names[class_id])
            confidence = float(box.conf[0])
            bbox = box.xyxyn[0].tolist()
            advisory = preparation_notes(dish_name)
            detections.append({
                "dish": dish_name,
                "dish_id": dish_name.lower().replace(" ", "_"),
                "class_id": class_id,
                "detection_id": len(detections),
                "confidence": round(confidence * 100, 1),
                "bbox": bbox,
                "advisory": advisory
            })

    detections.sort(key=lambda item: item["confidence"], reverse=True)
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
def model_metrics():
    try:
        report = json.loads((BASE_DIR / "docs/model-evaluation.json").read_text(encoding="utf-8"))
        actual_hash = hashlib.sha256(MODEL_WEIGHTS_PATH.read_bytes()).hexdigest()
        if report["checkpoint_sha256"] != actual_hash:
            raise ValueError("Evaluation checkpoint mismatch")
        return report
    except (OSError, ValueError, KeyError):
        logger.exception("Evaluation report unavailable or checkpoint mismatch")
        raise HTTPException(503, "Verified evaluation report unavailable for this checkpoint") from None


PUBLIC_FILES = {
    "app.js": BASE_DIR / "app.js",
    "sample.jpg": BASE_DIR / "samples/daing-na-bangus.jpg",
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
