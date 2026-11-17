import unittest
from unittest.mock import patch
from types import SimpleNamespace

from fastapi.testclient import TestClient
from main import app


class PublicFilesTests(unittest.TestCase):
    def setUp(self):
        self.loader = patch("main.load_detector", return_value=SimpleNamespace(names={0: "dish"}))
        self.loader.start()
        self.addCleanup(self.loader.stop)

    def test_private_files_are_not_served(self):
        with TestClient(app) as client:
            for path in ("main.py", ".git/HEAD", ".env", "requirements.txt",
                         "models/kaoncheck.pt", "../main.py"):
                with self.subTest(path=path):
                    self.assertEqual(client.get(f"/static/{path}").status_code, 404)

    def test_public_assets_remain_available(self):
        with TestClient(app) as client:
            for path in ("/", "/static/app.js", "/static/styles.css",
                         "/static/runs/detect/kaoncheck-4/results.png"):
                self.assertEqual(client.get(path).status_code, 200)

    def test_cross_origin_access_is_not_enabled(self):
        with TestClient(app) as client:
            response = client.get("/", headers={"Origin": "https://untrusted.example"})
            self.assertNotIn("access-control-allow-origin", response.headers)
