from ultralytics import YOLO

if __name__ == '__main__':
    model = YOLO("yolov8n.pt")

    results = model.train(
        data="dataset/data.yaml",
        epochs=100,
        imgsz=640,
        batch=16,
        name="kaoncheck",
        device=0,
        workers=0
    )