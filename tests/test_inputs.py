import io
import unittest
from types import SimpleNamespace
from unittest.mock import patch, Mock

from fastapi.testclient import TestClient
from PIL import Image
import main


def image_bytes(format="PNG"):
    out = io.BytesIO()
    Image.new("RGB", (32, 32), "white").save(out, format)
    return out.getvalue()


class InputTests(unittest.TestCase):
    def setUp(self):
        self.detector = Mock(return_value=[])
        self.detector.names = {0: "dish"}
        self.loader = patch("main.load_detector", return_value=self.detector)
        self.loader.start()
        self.client = TestClient(main.app)
        self.client.__enter__()
        self.addCleanup(self.loader.stop)
        self.addCleanup(self.client.__exit__, None, None, None)

    def upload(self, data, name="photo.png"):
        return self.client.post("/analyze", files={"file": (name, data)})

    def test_invalid_uploads_never_reach_detector(self):
        for name, body in [("empty.jpg", b""), ("paths.txt", b"main.py"), ("invalid.jpg", b"not an image")]:
            self.assertEqual(self.upload(body, name).status_code, 422)
        self.assertEqual(self.upload(image_bytes("GIF")).status_code, 415)
        self.detector.assert_not_called()

    def test_byte_pixel_and_request_limits(self):
        with patch.object(main, "MAX_UPLOAD_BYTES", 10):
            self.assertEqual(self.upload(image_bytes()).status_code, 413)
        with patch.object(main, "MAX_IMAGE_PIXELS", 10):
            self.assertEqual(self.upload(image_bytes()).status_code, 413)
        response = self.client.post("/analyze", content=b"x", headers={"Content-Length": "99999999"})
        self.assertEqual(response.status_code, 413)

    def test_chunked_body_limit(self):
        self.client.app.middleware_stack = None
        with patch.object(main.RequestLimitMiddleware, "__init__", autospec=True) as init:
            def setup(instance, app, max_bytes):
                instance.app, instance.max_bytes = app, 20
            init.side_effect = setup
            response = self.client.post("/analyze", content=iter([b"x" * 30]),
                                        headers={"Content-Type": "multipart/form-data; boundary=x"})
        self.assertEqual(response.status_code, 413)
        self.client.app.middleware_stack = None

    def test_valid_image_uses_decoded_pixels_not_filename(self):
        self.assertEqual(self.upload(image_bytes(), "paths.txt").status_code, 200)
        self.assertIsInstance(self.detector.call_args.args[0], Image.Image)

    def test_exif_orientation_matches_browser_preview(self):
        out = io.BytesIO()
        image = Image.new("RGB", (32, 16))
        exif = Image.Exif()
        exif[274] = 6
        image.save(out, "JPEG", exif=exif)
        self.assertEqual(self.upload(out.getvalue()).status_code, 200)
        self.assertEqual(self.detector.call_args.args[0].size, (16, 32))

    def test_busy_and_inference_failure(self):
        with main.inference_lock:
            self.assertEqual(self.upload(image_bytes()).status_code, 429)
        self.detector.side_effect = RuntimeError("private backend detail")
        with self.assertLogs(main.logger, level="ERROR"):
            response = self.upload(image_bytes())
        self.assertEqual(response.status_code, 500)
        self.assertNotIn("private backend", response.text)
        self.assertFalse(main.inference_lock.locked())

    def test_invalid_chat_is_rejected_before_stream_headers(self):
        for history in ('{}', 'null', '[1]', '"string"', '[{"role":"system","content":"x"}]',
                        '[{"role":[],"content":"x"}]', '[' * 1500 + ']' * 1500):
            for endpoint in ("/advisor/stream", "/advisor/reply"):
                self.assertEqual(self.client.post(endpoint, data={"dish": "Boiled Rice", "history": history}).status_code, 422)
        self.assertEqual(self.client.post("/advisor/reply", data={"dish": "Boiled Rice", "meal_context": "[]"}).status_code, 422)
        self.assertEqual(self.client.post("/advisor/stream", data={"dish": "Boiled Rice", "question": "x" * 2001}).status_code, 422)
