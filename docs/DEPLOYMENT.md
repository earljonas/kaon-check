# Demo and deployment checklist

## Local hiring-manager demo

- [ ] Follow the README's four setup commands in a clean Python 3.12 environment.
- [ ] Confirm `/health/ready` returns 200 and the page says Scanner ready.
- [ ] Use Try sample → Analyze dish → View scan details → Escape → New scan.
- [ ] Show another supported-food photo and a blank/unsupported example. Explain that unsupported-food rejection is imperfect.
- [ ] Show preserved instances, normalized boxes, confidence, and inference timing without calling confidence “accuracy.”
- [ ] Explain the evaluation report's duplicate-image caveat; do not claim independent test accuracy.
- [ ] Run Ruff, JavaScript syntax, 17 API tests, and 9 Chromium tests from the README.
- [ ] Capture a screenshot/GIF from the actual current app. The README includes a real screenshot; no public URL is invented.

## Before publishing any public endpoint

- [ ] Choose a host that supports Python 3.12, CPU PyTorch, the checkpoint, and enough memory. Measure startup time and memory on that host; no minimum-resource benchmark is claimed.
- [ ] Install the tested runtime lock and verify the bundled checkpoint SHA-256. Keep weights and dataset files outside the public asset allowlist.
- [ ] Use one worker initially, so the one-inference gate has the intended behavior. Additional workers each consume model memory and have independent gates.
- [ ] Configure HTTPS and forward traffic to the same-origin app. No separate frontend or AI service is required.
- [ ] Configure request-rate and concurrent-connection limits at the hosting/proxy boundary. The application has no accounts, authentication, or per-user quotas; do not publish an unrestricted compute endpoint.
- [ ] Set proxy body limits consistently with the configured image limit plus multipart overhead. Configure request timeouts and assess inference latency against the browser's 30-second deadline.
- [ ] Preserve readiness semantics: route health probes to `/health/ready`, and investigate 503s in server logs. A served index page alone does not prove model availability.
- [ ] Keep `.env` and credentials out of Git; set environment variables through the host. The current app needs no API keys.
- [ ] Review dataset/model/package attribution and applicable licenses before redistribution. Do not publish the excluded dataset or research drafts accidentally.
- [ ] Run the full checks and smoke-test valid, invalid, too-large, busy, and no-detection requests against the actual host. Verify `/static/.env` and `/static/.git/HEAD` return 404.
- [ ] Verify logs contain useful errors without uploaded images or unnecessary request content. Understand that multipart parsing can temporarily spool files and that browser cancellation does not stop in-flight inference.
- [ ] Record the deployed commit, checkpoint hash, configuration, and rollback procedure. Retain the prior working deployment for rollback.
- [ ] Add a real demo URL to the README only after the deployment is reachable and verified. No live deployment is currently claimed.

## Updating the model later

- [ ] Remove exact and near-duplicate split leakage before retraining.
- [ ] Freeze training/model-selection and final-evaluation data boundaries.
- [ ] Train and evaluate the new checkpoint; publish its configuration, dataset manifest, failures, and measured limits.
- [ ] Update `models/kaoncheck.pt`, its checksum, the checkpoint-linked report, and associated charts together.
- [ ] Re-run real-model browser tests and inspect screenshots before release.
