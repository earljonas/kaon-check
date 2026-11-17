"""Chromium tests against a real server and bundled CPU model.

Only failure/timing scenarios intercept requests; the main flow uses real inference.
"""
import io
from pathlib import Path
import socket
import subprocess
import sys
import time
import unittest
from urllib.error import URLError
from urllib.request import urlopen

from PIL import Image
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
SAMPLE = ROOT / "samples/daing-na-bangus.jpg"


class BrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.artifacts = ROOT / ".artifacts"
        cls.artifacts.mkdir(exist_ok=True)
        cls.log = (cls.artifacts / "browser-server.log").open("w", encoding="utf-8")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        cls.url = f"http://127.0.0.1:{port}"
        cls.server = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(port)],
            cwd=ROOT, stdout=cls.log, stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        cls.addClassCleanup(cls.stop_server)
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            if cls.server.poll() is not None:
                raise RuntimeError("Browser server exited; see .artifacts/browser-server.log")
            try:
                with urlopen(cls.url + "/health/ready", timeout=1) as response:
                    if response.status == 200:
                        break
            except (URLError, TimeoutError):
                time.sleep(.1)
        else:
            raise RuntimeError("Browser server did not become ready; see .artifacts/browser-server.log")
        cls.playwright = sync_playwright().start()
        cls.addClassCleanup(cls.playwright.stop)
        cls.browser = cls.playwright.chromium.launch()
        cls.addClassCleanup(cls.browser.close)

    @classmethod
    def stop_server(cls):
        cls.server.terminate()
        try:
            cls.server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            cls.server.kill()
            cls.server.wait(timeout=5)
        cls.log.close()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1280, "height": 900})
        self.addCleanup(self.context.close)
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        # The app must work without external fonts, APIs, or CDNs.
        self.page.route("**/*", lambda route: route.continue_() if route.request.url.startswith(self.url) else route.abort())

    def tearDown(self):
        self.assertEqual(self.errors, [])

    def open(self):
        self.page.goto(self.url)
        expect(self.page.locator("#scannerStatus")).to_have_text("Scanner ready")

    def choose(self):
        self.page.locator("#fileInput").set_input_files(SAMPLE)
        expect(self.page.locator("#analyzeBtn")).to_be_enabled()

    def test_real_sample_flow_metrics_keyboard_and_reset(self):
        self.open()
        self.page.get_by_role("button", name="Try sample").click()
        expect(self.page.locator("#analyzeBtn")).to_be_enabled()
        self.page.locator("#analyzeBtn").click()
        expect(self.page.locator("#results h2")).to_have_text("Detected foods")
        count = self.page.locator("#results .detected-foods li").count()
        self.assertGreater(count, 0)
        expect(self.page.locator(".bounding-box")).to_have_count(count)
        self.assertNotIn("\ufffd", self.page.locator("body").inner_text())
        self.page.screenshot(path=str(self.artifacts / "desktop.png"), full_page=True)
        self.page.get_by_role("button", name="View scan details").click()
        expect(self.page.locator("#metricsFootnote")).to_contain_text("not independent test performance")
        expect(self.page.locator("#closeMetrics")).to_be_focused()
        self.page.keyboard.press("Escape")
        expect(self.page.get_by_role("button", name="View scan details")).to_be_focused()
        self.page.get_by_role("button", name="New scan").click()
        expect(self.page.locator("#results")).to_be_empty()
        expect(self.page.get_by_role("button", name="Upload photo", exact=True)).to_be_focused()

    def test_keyboard_photo_selection_and_mobile_boxes(self):
        self.open()
        self.page.locator("#uploadZone").focus()
        with self.page.expect_file_chooser() as chooser:
            self.page.keyboard.press("Enter")
        chooser.value.set_files(SAMPLE)
        expect(self.page.locator("#analyzeBtn")).to_be_enabled()
        self.page.locator("#analyzeBtn").click()
        expect(self.page.locator("#results h2")).to_have_text("Detected foods")
        self.page.set_viewport_size({"width": 320, "height": 740})
        expect(self.page.locator(".bounding-box")).not_to_have_count(0)
        self.page.wait_for_function("document.querySelector('.bounding-box').getBoundingClientRect().right <= document.querySelector('#preview').getBoundingClientRect().right + 1")
        self.assertTrue(self.page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
        self.page.screenshot(path=str(self.artifacts / "mobile.png"), full_page=True)

    def test_invalid_image_and_client_size_limit(self):
        self.page.route("**/health/ready", lambda route: route.fulfill(json={"ready": True, "max_upload_bytes": 1000}))
        self.open()
        self.page.locator("#fileInput").set_input_files({"name": "bad.png", "mimeType": "image/png", "buffer": b"broken"})
        expect(self.page.locator("#scanStatus")).to_contain_text("could not be opened")
        self.page.locator("#fileInput").set_input_files(SAMPLE)
        expect(self.page.locator("#scanStatus")).to_contain_text("up to")
        expect(self.page.locator("#analyzeBtn")).to_be_disabled()

    def test_real_blank_image_has_retryable_no_detection_state(self):
        self.open()
        out = io.BytesIO()
        Image.new("RGB", (320, 240), "white").save(out, "PNG")
        self.page.locator("#fileInput").set_input_files({"name": "blank.png", "mimeType": "image/png", "buffer": out.getvalue()})
        expect(self.page.locator("#analyzeBtn")).to_be_enabled()
        self.page.locator("#analyzeBtn").click()
        expect(self.page.locator("#results h2")).to_have_text("No supported food detected")
        expect(self.page.locator("#analyzeBtn")).to_be_enabled()
        expect(self.page.locator(".bounding-box")).to_have_count(0)

    def test_backend_error_is_shown_and_retry_works(self):
        self.open()
        self.choose()
        self.page.route("**/analyze", lambda route: route.fulfill(status=429, json={"detail": "Detector busy; try again shortly"}), times=1)
        self.page.locator("#analyzeBtn").click()
        expect(self.page.locator("#scanStatus")).to_contain_text("Detector busy")
        expect(self.page.locator("#analyzeBtn")).to_be_enabled()
        self.page.locator("#analyzeBtn").click()
        expect(self.page.locator("#results h2")).to_have_text("Detected foods")

    def test_reset_cancels_pending_request_and_ignores_late_response(self):
        self.open()
        self.choose()
        pending = []
        self.page.route("**/analyze", lambda route: pending.append(route))
        self.page.locator("#analyzeBtn").click()
        expect(self.page.locator("#scanStatus")).to_have_text("Analyzing photo…")
        with self.page.expect_event("requestfailed"):
            self.page.locator("#newScanBtn").click()
        self.assertEqual(len(pending), 1)
        pending[0].fulfill(json={"detections": [], "model": "YOLOv8n", "inference_ms": 1})
        expect(self.page.locator("#results")).to_be_empty()
        expect(self.page.locator("#previewContainer")).to_be_hidden()
        self.choose()
        expect(self.page.locator("#results")).to_be_empty()

    def test_timeout_releases_controls(self):
        self.page.add_init_script("const original = window.setTimeout; window.setTimeout = (fn, ms, ...args) => original(fn, ms === 30000 ? 30 : ms, ...args);")
        self.open()
        self.choose()
        self.page.route("**/analyze", lambda route: None)
        self.page.locator("#analyzeBtn").click()
        expect(self.page.locator("#scanStatus")).to_contain_text("timed out")
        expect(self.page.locator("#analyzeBtn")).to_be_enabled()

    def test_unavailable_scanner_can_be_rechecked(self):
        self.page.route("**/health/ready", lambda route: route.fulfill(status=503, json={"detail": "Unavailable"}), times=1)
        self.page.goto(self.url)
        expect(self.page.locator("#scannerStatus")).to_have_text("Scanner unavailable")
        self.choose_without_readiness()
        expect(self.page.locator("#analyzeBtn")).to_be_disabled()
        self.page.get_by_role("button", name="Check scanner").click()
        expect(self.page.locator("#analyzeBtn")).to_be_enabled()

    def choose_without_readiness(self):
        self.page.locator("#fileInput").set_input_files(SAMPLE)
        expect(self.page.locator("#scanStatus")).to_contain_text("Photo ready")

    def test_missing_metrics_does_not_break_scan(self):
        self.open()
        self.choose()
        self.page.locator("#analyzeBtn").click()
        expect(self.page.locator("#results h2")).to_have_text("Detected foods")
        self.page.route("**/model-metrics", lambda route: route.fulfill(status=503, json={"detail": "Verified evaluation report unavailable"}))
        self.page.get_by_role("button", name="View scan details").click()
        expect(self.page.locator("#metricsModelGrid")).to_contain_text("Metrics unavailable")
        self.page.keyboard.press("Escape")
        expect(self.page.locator("#results h2")).to_have_text("Detected foods")
