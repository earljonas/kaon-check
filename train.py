"""Optional training tool. Requires a local dataset and trusted base weights.

This does not overwrite the bundled demo checkpoint or regenerate its report.
"""
import argparse
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True, help="Local YOLO dataset YAML")
    parser.add_argument("--weights", type=Path, required=True, help="Local trusted YOLOv8n base weights")
    parser.add_argument("--device", default="cpu", help="cpu or a CUDA device such as 0")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--name", default="kaoncheck")
    args = parser.parse_args()
    if not args.data.is_file() or not args.weights.is_file():
        parser.error("Both dataset YAML and base weights must exist locally")
    if args.epochs <= 0:
        parser.error("epochs must be positive")
    from ultralytics import YOLO
    YOLO(str(args.weights.resolve())).train(
        data=str(args.data.resolve()), epochs=args.epochs, imgsz=640,
        batch=16, name=args.name, device=args.device, workers=0,
        project=str(root / "runs/detect"), exist_ok=False,
    )


if __name__ == "__main__":
    main()
