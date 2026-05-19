from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
from nlp import get_quick_advisory, stream_nutrition_reply, get_yobab_reply
import csv
import shutil
import os
import uuid
import json
import time

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_RUN_DIR = "runs/detect/kaoncheck-4"
MODEL_WEIGHTS_PATH = f"{MODEL_RUN_DIR}/weights/best.pt"

model = YOLO(MODEL_WEIGHTS_PATH)

@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    _, ext = os.path.splitext(file.filename or "")
    temp_path = f"temp_{uuid.uuid4().hex}{ext or '.jpg'}"

    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        started_at = time.perf_counter()
        results = model(temp_path)
        inference_ms = round((time.perf_counter() - started_at) * 1000, 1)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

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


@app.post("/advisor/stream")
async def advisor_stream(
    dish: str = Form(...),
    question: str = Form(""),
    history: str = Form("")
):
    # This one handles the real-time chat streaming
    return StreamingResponse(
        stream_nutrition_reply(dish, question, history),
        media_type="text/plain; charset=utf-8",
    )


@app.post("/advisor/reply")
async def advisor_reply(
    dish: str = Form(...),
    question: str = Form(""),
    history: str = Form(""),
    meal_context: str = Form(""),
):
    # Just a regular POST in case we don't need streaming
    parsed_history = []
    if history:
        try:
            parsed_history = json.loads(history)
        except json.JSONDecodeError:
            parsed_history = []

    parsed_meal = None
    if meal_context:
        try:
            parsed_meal = json.loads(meal_context)
        except json.JSONDecodeError:
            parsed_meal = None

    # If we don't have full meal data, just use the name
    if not parsed_meal:
        parsed_meal = {"food_name": dish}

    reply = get_yobab_reply(question, parsed_history, parsed_meal)
    return {"reply": reply}


app.mount("/static", StaticFiles(directory="."), name="static")

@app.get("/")
async def read_index():
    return FileResponse('index.html')
