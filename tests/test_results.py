from types import SimpleNamespace
import unittest
from unittest.mock import patch, Mock

from fastapi.testclient import TestClient
import main
import dishes
from test_inputs import image_bytes


def box(class_id, confidence):
    return SimpleNamespace(cls=[class_id], conf=[confidence],
                           xyxyn=[SimpleNamespace(tolist=lambda: [0.1, 0.2, 0.8, 0.9])])


class ResultTests(unittest.TestCase):
    def test_instances_are_preserved_sorted_and_canonical(self):
        detector = Mock(return_value=[SimpleNamespace(boxes=[box(0, .8), box(0, .9), box(1, .7)])])
        detector.names = {0: "Chicken -Chicken Inasal-", 1: "White Rice -Boiled Rice-"}
        with patch.object(main, "load_detector", return_value=detector), TestClient(main.app) as client:
            response = client.post("/analyze", files={"file": ("food.png", image_bytes())})
        self.assertEqual(response.status_code, 200)
        results = response.json()["detections"]
        self.assertEqual(len(results), 3)
        self.assertEqual([r["confidence"] for r in results], [90, 80, 70])
        self.assertEqual([r["dish_id"] for r in results], ["chicken_inasal", "chicken_inasal", "boiled_rice"])
        self.assertEqual(len({r["detection_id"] for r in results}), 3)
        self.assertNotIn("Health Score", results[0]["advisory"])

    def test_all_dataset_labels_share_one_knowledge_lookup(self):
        names = ["Adobong Iga", "Chicken Inasal", "Fried Chicken", "Daing na Bangus",
                 "Pan Fried Tilapia", "Sinaing na Tulingan", "Breaded Pork Chop",
                 "Lechon Kawali", "Pork Bistek", "Boiled Rice", "Fried Rice"]
        for name in names:
            with self.subTest(name=name):
                self.assertEqual(dishes.preparation_notes(name), dishes.preparation_notes(f"Category -{name}-"))
                self.assertNotIn("score", dishes.DISHES[name.lower()])

    def test_report_matches_checkpoint_and_discloses_leakage(self):
        with patch.object(main, "load_detector", return_value=SimpleNamespace(names={})), TestClient(main.app) as client:
            response = client.get("/model-metrics")
        self.assertEqual(response.status_code, 200)
        report = response.json()
        self.assertEqual(report["checkpoint_epoch"], 86)
        self.assertAlmostEqual(report["validation_metrics"]["map50_95"], .78538)
        self.assertEqual(report["split_audit"]["validation_images_matching_train"], 55)
        self.assertIn("not independent test performance", report["note"])

    def test_missing_or_mismatched_report_is_unavailable_not_zero(self):
        with patch.object(main, "load_detector", return_value=SimpleNamespace(names={})), TestClient(main.app) as client:
            with patch("pathlib.Path.read_bytes", return_value=b"other checkpoint"), self.assertLogs(main.logger):
                self.assertEqual(client.get("/model-metrics").status_code, 503)
            with patch("pathlib.Path.read_text", side_effect=FileNotFoundError), self.assertLogs(main.logger):
                self.assertEqual(client.get("/model-metrics").status_code, 503)
