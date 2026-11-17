import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
import main


class StartupTests(unittest.TestCase):
    def test_bundled_model_loads_from_another_working_directory(self):
        previous = Path.cwd()
        with tempfile.TemporaryDirectory() as directory:
            try:
                os.chdir(directory)
                with TestClient(main.app) as client:
                    self.assertEqual(client.get("/").status_code, 200)
                    self.assertEqual(client.get("/health/ready").json()["classes"], 11)
            finally:
                os.chdir(previous)

    def test_missing_model_reports_unavailable(self):
        with patch.object(main, "MODEL_WEIGHTS_PATH", Path("missing-checkpoint.pt")):
            with self.assertLogs(main.logger, level="ERROR"):
                with TestClient(main.app) as client:
                    self.assertEqual(client.get("/").status_code, 200)
                    self.assertEqual(client.get("/health/ready").status_code, 503)
                    self.assertEqual(client.post("/analyze", files={"file": ("x.jpg", b"x")}).status_code, 503)

    def test_corrupt_bundle_is_rejected(self):
        with patch.object(main.Path, "read_bytes", return_value=b"not the checkpoint"):
            with self.assertRaisesRegex(ValueError, "checksum"):
                main.load_detector()
