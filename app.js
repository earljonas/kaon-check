document.addEventListener('DOMContentLoaded', () => {
  const byId = id => document.getElementById(id);
  const preview = byId('preview');
  const results = byId('results');
  const analyze = byId('analyzeBtn');
  const input = byId('fileInput');
  const dialog = byId('metricsModal');
  let file = null;
  let objectUrl = null;
  let request = null;
  let metricsRequest = null;
  let generation = 0;
  let ready = false;
  let busy = false;
  let details = null;
  let opener = null;
  let maxBytes = 10485760;

  function element(tag, text, className = '') {
    const node = document.createElement(tag);
    node.textContent = text;
    node.className = className;
    return node;
  }

  async function fetchChecked(url, options, controller, timeout = 30000) {
    const timer = setTimeout(() => controller.abort('timeout'), timeout);
    try {
      const response = await fetch(url, {...options, signal: controller.signal});
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.detail === 'string' ? body.detail : `Request failed (${response.status}). Try again.`);
      }
      // Include body decoding in the deadline, not just response headers.
      return url === '/static/sample.jpg' ? await response.blob() : await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function message(error, controller) {
    if (controller.signal.aborted) return 'Request timed out. Try again or check the scanner.';
    return error instanceof TypeError ? 'Cannot reach the scanner. Check the server and try again.' : error.message;
  }

  function controls() {
    analyze.disabled = !file || !ready || busy;
    analyze.textContent = busy ? 'Analyzing…' : 'Analyze dish';
    byId('sampleBtn').disabled = busy;
    byId('scannerStatus').textContent = ready ? 'Scanner ready' : 'Scanner unavailable';
  }

  function reset() {
    generation += 1;
    request?.abort();
    request = null;
    closeMetrics();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    file = null;
    details = null;
    busy = false;
    input.value = '';
    preview.removeAttribute('src');
    byId('previewContainer').style.display = 'none';
    byId('uploadZone').style.display = '';
    byId('boundingBoxContainer').replaceChildren();
    results.replaceChildren();
    results.classList.remove('is-visible');
    document.querySelector('.workspace').classList.add('no-results');
    document.querySelector('.right-column').classList.remove('has-results');
    byId('analyzeBtn').classList.add('is-hidden');
    byId('newScanBtn').classList.add('is-hidden');
    byId('uploadBtn').classList.remove('is-hidden');
    byId('sampleBtn').classList.remove('is-hidden');
    byId('scanStatus').textContent = '';
    byId('imageDetectionPill').textContent = 'Ready to analyze';
    controls();
  }

  async function selectFile(selected) {
    reset();
    const version = generation;
    if (!selected.size || selected.size > maxBytes) {
      byId('scanStatus').textContent = `Choose a nonempty image up to ${Math.floor(maxBytes / 1048576)} MiB.`;
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(selected.type)) {
      byId('scanStatus').textContent = 'Choose a JPEG, PNG, or WebP image.';
      return;
    }
    objectUrl = URL.createObjectURL(selected);
    preview.src = objectUrl;
    try {
      await preview.decode();
      if (version !== generation) return;
      file = selected;
      byId('previewContainer').style.display = 'block';
      byId('uploadZone').style.display = 'none';
      byId('analyzeBtn').classList.remove('is-hidden');
      byId('newScanBtn').classList.remove('is-hidden');
      byId('uploadBtn').classList.add('is-hidden');
      byId('sampleBtn').classList.add('is-hidden');
      byId('scanStatus').textContent = 'Photo ready. Select Analyze dish.';
      controls();
    } catch {
      if (version !== generation) return;
      reset();
      byId('scanStatus').textContent = 'This image could not be opened. Choose another photo.';
    }
  }

  async function checkReady() {
    byId('checkReadyBtn').disabled = true;
    const controller = new AbortController();
    try {
      const status = await fetchChecked('/health/ready', {}, controller, 10000);
      ready = status.ready === true;
      maxBytes = status.max_upload_bytes || maxBytes;
    } catch {
      ready = false;
    } finally {
      byId('checkReadyBtn').disabled = false;
      controls();
    }
  }

  function drawBoxes() {
    const container = byId('boundingBoxContainer');
    container.replaceChildren();
    if (!details || !preview.naturalWidth) return;
    const scale = Math.min(preview.clientWidth / preview.naturalWidth, preview.clientHeight / preview.naturalHeight);
    const width = preview.naturalWidth * scale;
    const height = preview.naturalHeight * scale;
    const left = (preview.clientWidth - width) / 2;
    const top = (preview.clientHeight - height) / 2;
    details.detections.forEach((detection, index) => {
      const [x1, y1, x2, y2] = detection.bbox;
      const box = element('div', '', 'bounding-box');
      Object.assign(box.style, {left: `${left + x1 * width}px`, top: `${top + y1 * height}px`,
        width: `${(x2 - x1) * width}px`, height: `${(y2 - y1) * height}px`});
      box.append(element('span', String(index + 1), 'box-number'));
      container.append(box);
    });
  }

  function renderResult() {
    const detections = details.detections;
    const card = element('article', '', 'result-card');
    if (!detections.length) {
      card.append(element('h2', 'No supported food detected'));
      card.append(element('p', 'Try a clearer photo. Recognition is limited to 11 trained food classes.'));
    } else {
      card.append(element('h2', 'Detected foods'));
      const list = element('ol', '', 'detected-foods');
      detections.forEach(detection => list.append(element('li', `${detection.dish} — ${detection.confidence}% model confidence`)));
      card.append(list, element('p', 'Confidence is a model score, not a calibrated probability of correctness.', 'metrics-note'));
      const primary = detections[0];
      const notes = primary.advisory;
      card.append(element('h3', `Preparation notes: ${primary.dish}`));
      card.append(element('p', 'Notes apply to the highest-confidence detection. Portions and nutrients are not measured.'));
      const rows = element('dl', '', 'advice-list');
      [['Watch', notes['Health Risk']], ['Pair with', notes.Recommendation], ['Alternative', notes['Healthier Alternative']]]
        .forEach(([label, text]) => {
          const row = element('div', '', 'advice-item');
          row.append(element('dt', label), element('dd', text));
          rows.append(row);
        });
      card.append(rows);
    }
    const button = element('button', 'View scan details', 'btn-secondary details-btn');
    button.type = 'button';
    button.addEventListener('click', openMetrics);
    card.append(button);
    results.replaceChildren(card);
    results.classList.add('is-visible');
    document.querySelector('.workspace').classList.remove('no-results');
    document.querySelector('.right-column').classList.add('has-results');
    byId('imageDetectionPill').textContent = `${detections.length} food instance${detections.length === 1 ? '' : 's'}`;
    drawBoxes();
  }

  async function analyzeFile() {
    if (!file || busy || !ready) return;
    request?.abort();
    const controller = new AbortController();
    request = controller;
    const version = generation;
    busy = true;
    details = null;
    results.replaceChildren();
    byId('boundingBoxContainer').replaceChildren();
    byId('scanStatus').textContent = 'Analyzing photo…';
    controls();
    const body = new FormData();
    body.append('file', file);
    try {
      const data = await fetchChecked('/analyze', {method: 'POST', body}, controller);
      if (version !== generation) return;
      details = {...data, fileName: file.name, width: preview.naturalWidth, height: preview.naturalHeight};
      renderResult();
      byId('scanStatus').textContent = data.detections.length ? 'Analysis complete.' : 'No supported food detected.';
    } catch (error) {
      if (version !== generation) return;
      byId('scanStatus').textContent = message(error, controller);
    } finally {
      if (version === generation) {
        request = null;
        busy = false;
        controls();
      }
    }
  }

  function metric(label, value) {
    const card = element('div', '', 'metric-card');
    card.append(element('span', label), element('strong', value));
    return card;
  }

  async function openMetrics(event) {
    if (!details) return;
    opener = event.currentTarget;
    dialog.showModal();
    byId('closeMetrics').focus();
    byId('metricsScanSummary').replaceChildren(metric('Food instances', details.detections.length),
      metric('Inference time', `${details.inference_ms} ms`), metric('Image size', `${details.width} × ${details.height}`));
    const list = element('ol', '', 'detected-foods');
    details.detections.forEach(d => list.append(element('li', `${d.dish}: ${d.confidence}% confidence; normalized box ${d.bbox.map(v => v.toFixed(3)).join(', ')}`)));
    byId('metricsDetectionDetails').replaceChildren(list);
    byId('metricsModelGrid').replaceChildren(metric('Status', 'Loading…'));
    byId('metricsFootnote').textContent = '';
    byId('metricsChartGrid').replaceChildren();
    metricsRequest?.abort();
    const controller = new AbortController();
    metricsRequest = controller;
    try {
      const report = await fetchChecked('/model-metrics', {}, controller);
      if (controller !== metricsRequest || !dialog.open) return;
      const values = report.validation_metrics;
      byId('metricsModelGrid').replaceChildren(...[['Precision', values.precision], ['Recall', values.recall],
        ['mAP50', values.map50], ['mAP50–95', values.map50_95]].map(([label, value]) => metric(label, `${(value * 100).toFixed(2)}%`)));
      byId('metricsFootnote').textContent = report.note;
      report.charts.forEach(chart => {
        const figure = element('figure', '', 'metric-chart');
        const image = element('img', '');
        image.src = chart.url;
        image.alt = chart.label;
        image.loading = 'lazy';
        figure.append(image, element('figcaption', chart.label));
        byId('metricsChartGrid').append(figure);
      });
    } catch (error) {
      if (controller !== metricsRequest || !dialog.open) return;
      byId('metricsModelGrid').replaceChildren(metric('Metrics unavailable', message(error, controller)));
    }
  }

  function closeMetrics() {
    metricsRequest?.abort();
    metricsRequest = null;
    if (dialog.open) dialog.close();
  }
  dialog.addEventListener('close', () => {
    metricsRequest?.abort();
    metricsRequest = null;
    if (opener?.isConnected) opener.focus();
  });
  byId('closeMetrics').addEventListener('click', closeMetrics);
  byId('checkReadyBtn').addEventListener('click', checkReady);
  byId('uploadBtn').addEventListener('click', () => input.click());
  byId('uploadZone').addEventListener('click', () => input.click());
  byId('uploadZone').addEventListener('keydown', event => {
    if (['Enter', ' '].includes(event.key)) { event.preventDefault(); input.click(); }
  });
  input.addEventListener('change', () => { if (input.files[0]) selectFile(input.files[0]); });
  byId('newScanBtn').addEventListener('click', () => { reset(); byId('uploadBtn').focus(); });
  analyze.addEventListener('click', analyzeFile);
  byId('sampleBtn').addEventListener('click', async () => {
    reset();
    const version = generation;
    const controller = new AbortController();
    request = controller;
    busy = true;
    controls();
    byId('scanStatus').textContent = 'Loading sample…';
    try {
      const blob = await fetchChecked('/static/sample.jpg', {}, controller);
      if (version === generation) await selectFile(new File([blob], 'sample-daing-na-bangus.jpg', {type: 'image/jpeg'}));
    } catch (error) {
      if (version === generation) byId('scanStatus').textContent = message(error, controller);
    } finally {
      if (version === generation) { busy = false; request = null; controls(); }
    }
  });
  new ResizeObserver(drawBoxes).observe(preview);
  reset();
  checkReady();
});
