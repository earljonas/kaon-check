# Resume bullets

These describe implemented capabilities and verified counts. They make no claims about users, business impact, independent accuracy, or percentage performance improvements.

- Integrated YOLOv8n, FastAPI, and vanilla JavaScript into a CPU-ready photo recognition demo supporting **11 Filipino food classes**, preserving instance-level boxes and model confidence.
- Hardened image inference with **10 MiB upload limits**, a **20-million-pixel cap**, checksum-verified weights, and a **single-inference gate**, returning structured errors for invalid, oversized, busy, and unavailable requests.
- Added **26 automated checks—17 API/startup/security tests and 9 Chromium tests**—plus a GitHub Actions workflow covering real-model inference, invalid inputs, retries, cancellation, keyboard interaction, and evaluation provenance.

## Interview evidence

- Explain why the app serves an explicit asset allowlist instead of its project directory.
- Demonstrate reset during a pending request and explain cancellation plus generation checks.
- Distinguish per-photo model confidence from dataset precision/recall/mAP.
- Show the checkpoint-linked evaluation report and disclose the duplicate-image findings. Defensible limitations are stronger evidence than inflated accuracy claims.
- Explain why live camera streaming, LLM chat, and numerical health ratings were removed from v1.

The CI workflow is configured but no successful remote run is claimed until GitHub executes it. Tests have been run locally. Do not turn one observed inference time into a latency benchmark.
