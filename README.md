# KaonCheck

KaonCheck is a computer vision and NLP web app that recognizes Filipino food from images and gives practical nutrition guidance through a local AI assistant.

The project combines a YOLO object detection model, a FastAPI backend, and a lightweight browser UI for upload-based and live-camera meal scanning.

## Features

- Filipino food detection using YOLOv8
- Image upload and live camera scanner
- Bounding box visualization
- Per-scan confidence, inference time, image size, and detection details
- Model metrics modal with precision, recall, F1-score, mAP, training curves, and confusion matrix
- Rule-based quick nutrition advisory for detected dishes
- Yobab nutrition chat powered by Ollama and `llama3.1`
- Local-first demo setup with no cloud dependency

## Tech Stack

- Python
- FastAPI
- Ultralytics YOLOv8
- Ollama / llama3.1
- HTML, CSS, JavaScript

## Computer Vision Model

- Model: YOLOv8n
- Task: Object detection
- Weights: `runs/detect/kaoncheck-4/weights/best.pt`
- Training run: `runs/detect/kaoncheck-4`
- Dataset config: `dataset/data.yaml`
- Number of classes: 11

### Trained Classifications

| ID | Class |
|---:|---|
| 0 | Chicken - Adobong Iga |
| 1 | Chicken - Chicken Inasal |
| 2 | Chicken - Fried Chicken |
| 3 | Fish - Daing na Bangus |
| 4 | Fish - Pan Fried Tilapia |
| 5 | Fish - Sinaing na Tulingan |
| 6 | Pork - Breaded Pork Chop |
| 7 | Pork - Lechon Kawali |
| 8 | Pork - Pork Bistek |
| 9 | Rice - Boiled Rice |
| 10 | Rice - Fried Rice |

## Model Performance

These metrics come from the YOLO validation results in `runs/detect/kaoncheck-4/results.csv`.

| Metric | Score |
|---|---:|
| Precision | 97.46% |
| Recall | 93.41% |
| F1-score | 95.39% |
| mAP50 | 97.21% |
| mAP50-95 | 78.26% |

The app separates **per-scan prediction details** from **validation-set model metrics**. A single upload shows confidence and bounding boxes, while precision, recall, F1, and mAP describe model performance across the validation dataset.

Training artifacts are available in:

- `runs/detect/kaoncheck-4/results.png`
- `runs/detect/kaoncheck-4/BoxF1_curve.png`
- `runs/detect/kaoncheck-4/BoxPR_curve.png`
- `runs/detect/kaoncheck-4/confusion_matrix.png`

## NLP Assistant

Yobab is the nutrition assistant inside KaonCheck. It uses Ollama with `llama3.1` to answer questions about the detected meal, including portions, pairings, health risks, and healthier alternatives.

The assistant is constrained to provide general nutrition guidance only. It does not diagnose, prescribe, or claim exact calories from an image.

## Architecture

```text
User uploads image or opens camera
        |
        v
FastAPI /analyze
        |
        v
YOLOv8 detects food class, confidence, and bounding box
        |
        v
Frontend renders scan result and model details
        |
        v
User asks Yobab a nutrition question
        |
        v
FastAPI /advisor/stream
        |
        v
Ollama llama3.1 streams the response
```

## Setup

Install dependencies:

```bash
pip install -r requirements.txt
```

Install the local NLP model:

```bash
ollama pull llama3.1
```

Run the app:

```bash
uvicorn main:app --host 127.0.0.1 --port 8000
```

Open:

```text
http://127.0.0.1:8000
```

## Demo Notes

For the full demo, keep Ollama running before asking Yobab questions. The image scanner and model metrics work through FastAPI and YOLO; Yobab responses require the local Ollama model.

## Limitations

- Not a medical diagnosis tool
- Limited to the 11 trained Filipino food classes
- Detection quality depends on lighting, angle, occlusion, and image clarity
- Per-upload confidence is not the same as validation-set accuracy
- Nutrition guidance is general and should not replace a licensed professional

## Future Improvements

- Add more Filipino dish classes
- Add portion-size estimation
- Add calorie and macro estimation with stronger guardrails
- Improve mobile camera scanning
- Add model retraining and dataset version tracking
- Deploy as a PWA or hosted demo
