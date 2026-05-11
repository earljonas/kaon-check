from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
from nlp import get_quick_advisory, stream_nutrition_reply, get_yobab_reply
import shutil
import os
import uuid
import json

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
    _, ext = os.path.splitext(file.filename or "")
    temp_path = f"temp_{uuid.uuid4().hex}{ext or '.jpg'}"

    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        results = model(temp_path)
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
        return {"message": "No dish detected", "detections": []}

    return {"detections": detections}


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
