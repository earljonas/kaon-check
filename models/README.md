# Demo checkpoint

`kaoncheck.pt` is the existing YOLOv8n checkpoint copied from
`runs/detect/kaoncheck-4/weights/best.pt`. Its SHA-256 is recorded alongside it
and verified on startup. Only load trusted PyTorch checkpoints.

Training used the local 7,461-image, eleven-class Filipino Food Datasets
Roboflow export (CC BY 4.0, per its export metadata):
https://universe.roboflow.com/earls-workspace-khccb/filipino-food-datasets-kd7d6-z8qui

Upstream attribution: Dataset for Filipino Dishes,
https://universe.roboflow.com/dataset-for-filipino-dishes/filipino-food-datasets-kd7d6

Known limitation: exact duplicate images cross dataset splits. Existing
validation figures are exploratory, not independent test performance.
