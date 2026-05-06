from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
from nlp import get_health_advisory
import shutil
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

model = YOLO("runs/detect/kaoncheck-4/weights/best.pt")

@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    temp_path = f"temp_{file.filename}"
    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    results = model(temp_path)
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
            advisory = get_health_advisory(dish_name)
            detections.append({
                "dish": dish_name,
                "confidence": round(confidence * 100, 1),
                "advisory": advisory
            })

    if not detections:
        return {"message": "No dish detected", "detections": []}

    return {"detections": detections}