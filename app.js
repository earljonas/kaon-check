document.addEventListener('DOMContentLoaded', () => {
  const workspace = document.querySelector('.workspace');
  const uploadZone = document.getElementById('uploadZone');
  const fileInput = document.getElementById('fileInput');
  const preview = document.getElementById('preview');
  const previewContainer = document.getElementById('previewContainer');
  const scannerCard = document.querySelector('.scanner-card');
  const scanTitle = document.getElementById('scanTitle');
  const scanSubtitle = document.getElementById('scanSubtitle');
  const imageDetectionPill = document.getElementById('imageDetectionPill');
  const uploadBtn = document.getElementById('uploadBtn');
  const analyzeBtn = document.getElementById('analyzeBtn');
  const cameraBtn = document.getElementById('cameraBtn');
  const newScanBtn = document.getElementById('newScanBtn');
  const rightColumn = document.querySelector('.right-column');
  const resultsDiv = document.getElementById('results');
  const boundingBoxContainer = document.getElementById('boundingBoxContainer');
  const scanningLaser = document.getElementById('scanningLaser');
  const scanningOverlay = document.getElementById('scanningOverlay');

  // DOM elements for the camera
  const cameraModal = document.getElementById('cameraModal');
  const cameraFeed = document.getElementById('cameraFeed');
  const cameraStatus = document.getElementById('cameraStatus');
  const closeCamera = document.getElementById('closeCamera');
  const snapshot = document.getElementById('snapshot');

  // Scanning UI bits
  const liveScanningLaser = document.getElementById('liveScanningLaser');
  const liveScanningOverlay = document.getElementById('liveScanningOverlay');
  const liveBoundingBoxContainer = document.getElementById('liveBoundingBoxContainer');
  const liveArOverlayContainer = document.getElementById('liveArOverlayContainer');

  // The chat modal uses the same messages array as the smaller card
  const nutriChatModal = document.getElementById('nutriChatModal');
  const closeNutriChat = document.getElementById('closeNutriChat');
  const nutriChatMessages = document.getElementById('nutriChatMessages');
  const modalFollowUps = document.getElementById('modalFollowUps');
  const nutriChatForm = document.getElementById('nutriChatForm');
  const nutriChatInput = document.getElementById('nutriChatInput');

  // Computer vision metrics modal
  const metricsModal = document.getElementById('metricsModal');
  const closeMetrics = document.getElementById('closeMetrics');
  const metricsScanSummary = document.getElementById('metricsScanSummary');
  const metricsDetectionDetails = document.getElementById('metricsDetectionDetails');
  const metricsModelGrid = document.getElementById('metricsModelGrid');
  const metricsFootnote = document.getElementById('metricsFootnote');
  const metricsChartGrid = document.getElementById('metricsChartGrid');

  let currentFile = null;
  let stream = null;
  let scanInterval = null;
  let isScanning = false;
  let liveScanFailures = 0;
  let currentLiveDish = '';
  let mealContext = null;
  let lastScanDetails = null;
  let modelMetricsCache = null;

  // Store the conversation in memory for this session
  let messages = [
    { role: 'assistant', content: 'Ask me about this meal.' }
  ];

  const apiBaseUrl = window.location.port === '8000' ? '' : 'http://127.0.0.1:8000';

  uploadZone.addEventListener('click', () => fileInput.click());
  uploadBtn.addEventListener('click', () => fileInput.click());
  newScanBtn.addEventListener('click', resetApp);
  uploadZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) setFile(file);
  });

  function resetApp() {
    window.speechSynthesis?.cancel();
    uploadZone.style.display = '';
    previewContainer.style.display = '';
    workspace.classList.add('no-results');
    scannerCard.classList.remove('has-image', 'has-result');
    scanTitle.textContent = 'Check your Filipino meal in seconds.';
    scanSubtitle.textContent = 'Upload a photo or open your camera to scan your ulam.';
    imageDetectionPill.textContent = 'AI detected your ulam';
    uploadBtn.classList.remove('is-hidden');
    cameraBtn.classList.remove('is-hidden');
    analyzeBtn.classList.add('is-hidden');
    newScanBtn.classList.add('is-hidden');
    resultsDiv.classList.remove('is-visible');
    rightColumn.classList.remove('has-results');
    resultsDiv.innerHTML = '';
    fileInput.value = '';
    currentFile = null;
    mealContext = null;
    lastScanDetails = null;
    resetYobabMemory();
    analyzeBtn.disabled = true;
  }

  function setFile(file) {
    currentFile = file;
    const url = URL.createObjectURL(file);
    preview.src = url;

    uploadZone.style.display = 'none';
    previewContainer.style.display = 'block';
    scannerCard.classList.add('has-image');
    scannerCard.classList.remove('has-result');
    workspace.classList.add('no-results');
    scanTitle.textContent = 'Scanned dish';
    scanSubtitle.textContent = 'Review the photo, then analyze the dish.';
    imageDetectionPill.textContent = 'Ready to analyze';
    uploadBtn.classList.add('is-hidden');
    cameraBtn.classList.add('is-hidden');
    analyzeBtn.classList.remove('is-hidden');
    newScanBtn.classList.remove('is-hidden');

    analyzeBtn.disabled = false;
    analyzeBtn.innerText = 'Analyze dish';
    resultsDiv.classList.remove('is-visible');
    rightColumn.classList.remove('has-results');
    resultsDiv.innerHTML = '';
    boundingBoxContainer.innerHTML = '';
    mealContext = null;
    lastScanDetails = null;
    resetYobabMemory();
    window.speechSynthesis?.cancel();
  }

  function setCameraStatus(message, isError = false) {
    cameraStatus.textContent = message;
    cameraStatus.classList.toggle('error', isError);
    cameraStatus.style.display = message ? 'block' : 'none';
  }

  function waitForVideoReady(video) {
    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Camera preview timed out.'));
      }, 8000);

      function cleanup() {
        clearTimeout(timeout);
        video.removeEventListener('loadedmetadata', handleReady);
        video.removeEventListener('canplay', handleReady);
      }

      function handleReady() {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          cleanup();
          resolve();
        }
      }

      video.addEventListener('loadedmetadata', handleReady);
      video.addEventListener('canplay', handleReady);
    });
  }

  function canvasToBlob(canvas, type) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not capture a camera frame.'));
      }, type);
    });
  }

  async function openCameraStream() {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
    } catch (err) {
      console.warn('Rear camera unavailable, falling back to default camera:', err);
      return navigator.mediaDevices.getUserMedia({ video: true });
    }
  }

  // Opens the camera and starts the live scanning loop
  cameraBtn.addEventListener('click', async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API is unavailable.');
      }

      cameraBtn.disabled = true;
      cameraModal.classList.add('open');
      cameraModal.setAttribute('aria-hidden', 'false');
      setCameraStatus('Starting camera...');

      stream = await openCameraStream();
      cameraFeed.srcObject = stream;
      await cameraFeed.play();
      await waitForVideoReady(cameraFeed);

      liveScanningLaser.style.display = 'block';
      liveScanningOverlay.style.display = 'block';
      liveBoundingBoxContainer.innerHTML = '';
      liveArOverlayContainer.innerHTML = '';
      liveScanFailures = 0;
      setCameraStatus('Scanning...');

      // Run the initial scan, then repeat every 2 seconds
      await scanLiveFrame();
      scanInterval = setInterval(scanLiveFrame, 2000);
    } catch (err) {
      console.error('Camera start error:', err);
      stopCamera();
      alert("Camera access denied or unavailable. Use http://127.0.0.1:8000 or allow camera permission, then try again.");
    } finally {
      cameraBtn.disabled = false;
    }
  });

  async function scanLiveFrame() {
    if (!stream || isScanning) return;
    if (cameraFeed.readyState < 2 || cameraFeed.videoWidth === 0 || cameraFeed.videoHeight === 0) {
      setCameraStatus('Waiting for camera preview...');
      return;
    }

    isScanning = true;

    try {
      // Snag a frame and send it to the backend
      snapshot.width = cameraFeed.videoWidth;
      snapshot.height = cameraFeed.videoHeight;
      const ctx = snapshot.getContext('2d');
      ctx.drawImage(cameraFeed, 0, 0, snapshot.width, snapshot.height);
      const blob = await canvasToBlob(snapshot, 'image/jpeg');
      const formData = new FormData();
      formData.append('file', blob, 'frame.jpg');

      const res = await fetch(`${apiBaseUrl}/analyze`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`Analyze request failed: ${res.status}`);

      const data = await res.json();
      liveScanFailures = 0;
      setCameraStatus(data.detections && data.detections.length > 0 ? '' : 'Scanning...');

      liveBoundingBoxContainer.innerHTML = '';

      if (data.detections && data.detections.length > 0) {
        // Just show the first thing we find to keep the screen clean
        const det = data.detections[0];
        lastScanDetails = {
          fileName: 'Live camera frame',
          imageWidth: cameraFeed.videoWidth || 0,
          imageHeight: cameraFeed.videoHeight || 0,
          model: data.model || 'YOLO',
          inferenceMs: data.inference_ms ?? 'N/A',
          primaryDish: cleanFoodName(det.dish),
          primaryConfidence: det.confidence,
          healthScore: det.advisory?.['Health Score'] || 'N/A',
          healthLabel: getScoreLabel(Number.parseInt(det.advisory?.['Health Score'], 10) || 5),
          detections: data.detections
        };

        if (det.bbox) {
          drawLiveBoundingBox(det.bbox);
        }

        if (det.dish !== currentLiveDish) {
          currentLiveDish = det.dish;
          liveArOverlayContainer.innerHTML = '';
          renderArFloatingCard(det);
        }
      } else {
        currentLiveDish = '';
        liveArOverlayContainer.innerHTML = '';
      }
    } catch (e) {
      liveScanFailures += 1;
      console.error("Live scan error:", e);
      if (liveScanFailures >= 3) {
        if (scanInterval) {
          clearInterval(scanInterval);
          scanInterval = null;
        }
        liveScanningLaser.style.display = 'none';
        liveScanningOverlay.style.display = 'none';
        liveBoundingBoxContainer.innerHTML = '';
        liveArOverlayContainer.innerHTML = '';
        currentLiveDish = '';
        setCameraStatus('Scanner cannot reach the server. Restart the backend, then reopen the camera scanner.', true);
      } else {
        setCameraStatus(
          liveScanFailures >= 2 ? 'Scanner cannot reach the server. Retrying...' : 'Scanning...',
          liveScanFailures >= 2
        );
      }
    } finally {
      isScanning = false;
    }
  }

  function getObjectFitCoverRect(element, intrinsicWidth, intrinsicHeight) {
    const clientWidth = element.clientWidth;
    const clientHeight = element.clientHeight;

    if (!clientWidth || !clientHeight || !intrinsicWidth || !intrinsicHeight) {
      return { x: 0, y: 0, width: clientWidth, height: clientHeight };
    }

    const scale = Math.max(clientWidth / intrinsicWidth, clientHeight / intrinsicHeight);
    const width = intrinsicWidth * scale;
    const height = intrinsicHeight * scale;

    return {
      x: (clientWidth - width) / 2,
      y: (clientHeight - height) / 2,
      width,
      height
    };
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function getBoundingBoxRect(bbox, element, intrinsicWidth, intrinsicHeight) {
    const rendered = getObjectFitCoverRect(element, intrinsicWidth, intrinsicHeight);
    const rawX1 = rendered.x + bbox[0] * rendered.width;
    const rawY1 = rendered.y + bbox[1] * rendered.height;
    const rawX2 = rendered.x + bbox[2] * rendered.width;
    const rawY2 = rendered.y + bbox[3] * rendered.height;
    const x1 = clamp(rawX1, 0, element.clientWidth);
    const y1 = clamp(rawY1, 0, element.clientHeight);
    const x2 = clamp(rawX2, 0, element.clientWidth);
    const y2 = clamp(rawY2, 0, element.clientHeight);

    return {
      x: x1,
      y: y1,
      width: Math.max(x2 - x1, 0),
      height: Math.max(y2 - y1, 0)
    };
  }

  function drawLiveBoundingBox(bbox) {
    const rect = getBoundingBoxRect(bbox, cameraFeed, cameraFeed.videoWidth, cameraFeed.videoHeight);
    if (!rect.width || !rect.height) return;

    const box = document.createElement('div');
    box.className = 'live-bounding-box';
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    liveBoundingBoxContainer.appendChild(box);
  }

  function renderArFloatingCard(det) {
    const advisory = det.advisory || {};
    const scoreText = advisory['Health Score'] || '5/10';
    const scoreNum = Number.parseInt(scoreText, 10) || 5;

    let scoreColor = '#bf3f32';
    let scoreDesc = 'High Risk';
    if (scoreNum >= 7) { scoreColor = '#1f7a4f'; scoreDesc = 'Healthy Choice'; }
    else if (scoreNum >= 4) { scoreColor = '#c87913'; scoreDesc = 'Moderate'; }

    const card = document.createElement('div');
    card.className = 'ar-floating-card';
    card.innerHTML = `
      <div class="ar-dish-header">
        <div>
          <span class="ar-kicker">Yobab scan</span>
          <h4>${det.dish}</h4>
        </div>
        <span class="ar-confidence">${det.confidence}%</span>
      </div>
      <div class="ar-score-row">
        <div class="ar-score-main">
          <span>${scoreNum}</span><small>/10</small>
        </div>
        <div>
          <div class="ar-stat-label">Health score</div>
          <div class="ar-score-desc" style="color: ${scoreColor}">${scoreDesc}</div>
        </div>
      </div>
      <div class="ar-mini-bars">
        <div><span>Balance</span><i style="width:${Math.max(scoreNum * 10, 12)}%"></i></div>
        <div><span>Portion watch</span><i style="width:${Math.max((10 - scoreNum) * 10, 12)}%"></i></div>
      </div>
      <button class="ar-details-btn" type="button">View scan details</button>
      <div class="ar-details">
        <p class="ar-thinking">Analyzing nutritional content of ${det.dish}...</p>
        <p class="ar-ai-copy"></p>
      </div>
    `;
    liveArOverlayContainer.appendChild(card);
    card.querySelector('.ar-details-btn').addEventListener('click', openMetricsModal);
    streamYobabText(card.querySelector('.ar-ai-copy'), det.dish, '', null, card.querySelector('.ar-thinking'));
  }

  function getFollowUpQuestions(dish) {
    return [
      'Can I eat this often?',
      'What if I have diabetes?',
      'What if I have hypertension?',
      `What should I pair this with?`
    ];
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function typeText(target, text) {
    for (const char of text) {
      target.textContent += char;
      if (char.trim()) {
        await wait(8);
      }
    }
  }

  async function streamYobabText(target, dish, question = '', followUpContainer = null, thinkingTarget = null, history = []) {
    target.textContent = '';
    target.classList.add('is-streaming');
    if (thinkingTarget) {
      thinkingTarget.textContent = question ? `Yobab is thinking about ${dish}...` : `Analyzing nutritional content of ${dish}...`;
      thinkingTarget.style.display = 'block';
    } else {
      target.textContent = question ? `Yobab is thinking about ${dish}...` : `Analyzing nutritional content of ${dish}...`;
    }

    const formData = new FormData();
    formData.append('dish', dish);
    formData.append('question', question);
    formData.append('history', JSON.stringify(history));

    try {
      const res = await fetch(`${apiBaseUrl}/advisor/stream`, { method: 'POST', body: formData });
      if (!res.ok || !res.body) throw new Error(`Advisor stream failed: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let hasStarted = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!hasStarted) {
          hasStarted = true;
          target.textContent = '';
          if (!thinkingTarget) target.textContent = '';
          if (thinkingTarget) thinkingTarget.style.display = 'none';
        }
        await typeText(target, chunk);
        target.scrollTop = target.scrollHeight;
      }
    } catch (err) {
      console.error('Yobab stream error:', err);
      if (thinkingTarget) thinkingTarget.style.display = 'none';
      target.textContent = 'Yobab cannot reach the server right now. Please make sure the backend is running.';
    } finally {
      target.classList.remove('is-streaming');
      if (question) {
        target.textContent = limitSentences(target.textContent, 4);
      }
      if (followUpContainer && !question) {
        renderFollowUps(followUpContainer, dish);
      }
    }

    return target.textContent.trim();
  }

  function limitSentences(text, maxSentences = 4) {
    const sentences = text.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g);
    if (!sentences || sentences.length <= maxSentences) return text;
    return sentences.slice(0, maxSentences).join(' ').trim();
  }

  async function sendChatMessage(card, dish, question) {
    const message = question.trim();
    if (!message || card.dataset.streaming === 'true') return;

    const input = card.querySelector('.chat-input');
    const sendButton = card.querySelector('.chat-send');
    const followUps = card.querySelector('.follow-up-row');
    const answerPreview = card.querySelector('.answer-preview');
    const answerCopy = card.querySelector('.answer-copy');

    card.dataset.streaming = 'true';
    if (input) input.disabled = true;
    if (sendButton) sendButton.disabled = true;

    answerPreview.classList.remove('is-hidden');
    answerCopy.textContent = 'Yobab is thinking...';
    answerCopy.classList.add('is-streaming');
    if (followUps) followUps.innerHTML = '';

    await sendYobabMessage(message, {
      onStart: () => {
        answerCopy.textContent = '';
      },
      onToken: async (chunk) => {
        await typeText(answerCopy, chunk);
      },
      onDone: (finalAnswer) => {
        answerCopy.classList.remove('is-streaming');
        answerCopy.textContent = finalAnswer;
      }
    });

    renderFollowUps(followUps, dish);
    renderChatMessages();

    card.dataset.streaming = 'false';
    if (input) {
      input.disabled = false;
      input.value = '';
      input.focus();
    }
    if (sendButton) sendButton.disabled = false;
  }

  // Common function to send messages to Yobab
  async function sendYobabMessage(userMessage, hooks = {}) {
    const historyBeforeUserMessage = [...messages];
    messages.push({ role: 'user', content: userMessage });
    hooks.onThinking?.();
    await wait(120);

    let answer = '';
    let hasStartedStreaming = false;

    if (!mealContext) {
      answer = 'Scan a meal first so Yobab has dish context.';
      hooks.onStart?.();
      await hooks.onToken?.(answer, answer);
      messages.push({ role: 'assistant', content: answer });
      hooks.onDone?.(answer);
      return answer;
    }

    try {
      const formData = new FormData();
      formData.append('dish', mealContext.foodName);
      formData.append('question', userMessage);
      formData.append('history', JSON.stringify(historyBeforeUserMessage));

      const res = await fetch(`${apiBaseUrl}/advisor/stream`, { method: 'POST', body: formData });
      if (!res.ok || !res.body) throw new Error(`Advisor stream failed: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        if (!hasStartedStreaming) {
          hasStartedStreaming = true;
          hooks.onStart?.();
        }
        answer += chunk;
        await hooks.onToken?.(chunk, answer);
      }
    } catch (error) {
      console.error('Yobab stream failed:', error);
      answer = 'Yobab cannot reach the server right now. Please make sure the backend is running.';
      hooks.onStart?.();
      await hooks.onToken?.(answer, answer);
    }

    answer = limitSentences(answer.trim(), 5);
    messages.push({ role: 'assistant', content: answer });
    hooks.onDone?.(answer);
    return answer;
  }

  function attachChatComposer(card, dish) {
    const form = card.querySelector('.chat-composer');
    const input = card.querySelector('.chat-input');
    if (!form || !input) return;

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      sendChatMessage(card, dish, input.value);
    });
  }

  function renderFollowUps(container, dish) {
    if (!container) return;
    container.innerHTML = '';
    getFollowUpQuestions(dish).forEach((question) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'follow-up-chip';
      button.textContent = question;
      button.addEventListener('click', async () => {
        const card = button.closest('.ask-card');
        if (card) {
          await sendChatMessage(card, dish, question);
          return;
        }

        await sendFullChatQuestion(question);
      });
      container.appendChild(button);
    });
  }

  function resetYobabMemory() {
    messages = [
      { role: 'assistant', content: 'Ask me about this meal.' }
    ];
    renderChatMessages();
  }

  function openFullNutriChat() {
    if (!mealContext) return;
    nutriChatModal.classList.add('open');
    nutriChatModal.setAttribute('aria-hidden', 'false');
    renderFollowUps(modalFollowUps, mealContext.foodName);
    renderChatMessages();
    nutriChatInput.focus();
  }

  function closeFullNutriChat() {
    nutriChatModal.classList.remove('open');
    nutriChatModal.setAttribute('aria-hidden', 'true');
  }

  function closeMetricsModal() {
    metricsModal.classList.remove('open');
    metricsModal.setAttribute('aria-hidden', 'true');
  }

  function escapeHtml(value = '') {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatMetric(value, decimals = 1) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'N/A';
    return `${(number * 100).toFixed(decimals)}%`;
  }

  function formatBoxValue(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'N/A';
    return `${(number * 100).toFixed(1)}%`;
  }

  function metricCard(label, value, helper = '') {
    return `
      <div class="metric-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        ${helper ? `<small>${escapeHtml(helper)}</small>` : ''}
      </div>
    `;
  }

  async function getModelMetrics() {
    if (modelMetricsCache) return modelMetricsCache;
    const res = await fetch(`${apiBaseUrl}/model-metrics`);
    if (!res.ok) throw new Error(`Metrics request failed: ${res.status}`);
    modelMetricsCache = await res.json();
    return modelMetricsCache;
  }

  function renderScanMetrics() {
    if (!lastScanDetails) return;

    metricsScanSummary.innerHTML = [
      metricCard('Primary result', lastScanDetails.primaryDish),
      metricCard('Confidence', `${lastScanDetails.primaryConfidence}%`, 'This upload'),
      metricCard('Detections', String(lastScanDetails.detections.length), 'Unique classes'),
      metricCard('Inference time', `${lastScanDetails.inferenceMs} ms`, lastScanDetails.model),
      metricCard('Image size', `${lastScanDetails.imageWidth} x ${lastScanDetails.imageHeight}`, lastScanDetails.fileName),
      metricCard('Health score', lastScanDetails.healthScore, lastScanDetails.healthLabel)
    ].join('');

    metricsDetectionDetails.innerHTML = lastScanDetails.detections.length ? `
      <table class="detection-table">
        <thead>
          <tr>
            <th>Dish</th>
            <th>Confidence</th>
            <th>Box x1/y1</th>
            <th>Box x2/y2</th>
          </tr>
        </thead>
        <tbody>
          ${lastScanDetails.detections.map((det) => {
            const bbox = det.bbox || [];
            return `
              <tr>
                <td>${escapeHtml(cleanFoodName(det.dish))}</td>
                <td>${escapeHtml(det.confidence)}%</td>
                <td>${formatBoxValue(bbox[0])} / ${formatBoxValue(bbox[1])}</td>
                <td>${formatBoxValue(bbox[2])} / ${formatBoxValue(bbox[3])}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    ` : '<div class="detection-empty">No bounding box was produced for this upload.</div>';
  }

  function renderModelMetrics(metrics) {
    const validation = metrics.validation_metrics || {};
    metricsModelGrid.innerHTML = [
      metricCard('Precision', formatMetric(validation.precision), 'Validation set'),
      metricCard('Recall', formatMetric(validation.recall), 'Validation set'),
      metricCard('F1-score', formatMetric(validation.f1_score), 'Computed from P/R'),
      metricCard('mAP50', formatMetric(validation.map50), 'Accuracy proxy'),
      metricCard('mAP50-95', formatMetric(validation.map50_95), 'Stricter IoU range'),
      metricCard('Epochs', String(metrics.epochs || 'N/A'), metrics.run || '')
    ].join('');

    metricsFootnote.textContent = metrics.note || '';
    metricsChartGrid.innerHTML = (metrics.charts || []).map((chart) => `
      <figure class="metric-chart">
        <img src="${escapeHtml(chart.url)}" alt="${escapeHtml(chart.label)}">
        <figcaption>${escapeHtml(chart.label)}</figcaption>
      </figure>
    `).join('');
  }

  async function openMetricsModal() {
    if (!lastScanDetails) return;
    metricsModal.classList.add('open');
    metricsModal.setAttribute('aria-hidden', 'false');
    renderScanMetrics();
    metricsModelGrid.innerHTML = metricCard('Loading', '...', 'Reading YOLO results');
    metricsFootnote.textContent = '';
    metricsChartGrid.innerHTML = '';

    try {
      const metrics = await getModelMetrics();
      renderModelMetrics(metrics);
    } catch (err) {
      console.error('Model metrics failed:', err);
      metricsModelGrid.innerHTML = metricCard('Metrics unavailable', 'Check backend', 'Could not read results.csv');
    }
  }

  // Renders the full conversation memory in the modal.
  function renderChatMessages(draft = '') {
    if (!nutriChatMessages) return;
    nutriChatMessages.innerHTML = '';

    messages.forEach((message) => {
      const bubble = document.createElement('div');
      bubble.className = `nutri-message ${message.role}`;
      bubble.textContent = message.content;
      nutriChatMessages.appendChild(bubble);
    });

    if (draft) {
      const bubble = document.createElement('div');
      bubble.className = 'nutri-message assistant is-streaming';
      bubble.textContent = draft;
      nutriChatMessages.appendChild(bubble);
    }

    nutriChatMessages.scrollTop = nutriChatMessages.scrollHeight;
  }

  async function sendFullChatQuestion(question) {
    const message = question.trim();
    if (!message || !mealContext) return;

    nutriChatInput.disabled = true;
    const submitButton = nutriChatForm.querySelector('button');
    submitButton.disabled = true;

    await sendYobabMessage(message, {
      onThinking: () => renderChatMessages('Yobab is thinking...'),
      onStart: () => renderChatMessages(''),
      onToken: async (_chunk, draft) => renderChatMessages(draft),
      onDone: () => renderChatMessages()
    });
    renderFollowUps(modalFollowUps, mealContext.foodName);

    nutriChatInput.value = '';
    nutriChatInput.disabled = false;
    submitButton.disabled = false;
    nutriChatInput.focus();
  }

  closeNutriChat.addEventListener('click', closeFullNutriChat);

  nutriChatModal.addEventListener('click', (event) => {
    if (event.target === nutriChatModal) {
      closeFullNutriChat();
    }
  });

  closeMetrics.addEventListener('click', closeMetricsModal);

  metricsModal.addEventListener('click', (event) => {
    if (event.target === metricsModal) {
      closeMetricsModal();
    }
  });

  nutriChatForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await sendFullChatQuestion(nutriChatInput.value);
  });

  closeCamera.addEventListener('click', stopCamera);

  function stopCamera() {
    if (scanInterval) {
      clearInterval(scanInterval);
      scanInterval = null;
    }
    isScanning = false;
    liveScanFailures = 0;
    currentLiveDish = '';
    setCameraStatus('');
    liveScanningLaser.style.display = 'none';
    liveScanningOverlay.style.display = 'none';
    liveBoundingBoxContainer.innerHTML = '';
    liveArOverlayContainer.innerHTML = '';

    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    cameraFeed.pause();
    cameraFeed.srcObject = null;
    cameraModal.classList.remove('open');
    cameraModal.setAttribute('aria-hidden', 'true');
  }

  function cleanFoodName(label = '') {
    const normalized = label
      .replace(/\s+/g, ' ')
      .replace(/\s*-\s*/g, ' - ')
      .trim();

    const betweenDashes = normalized.match(/-\s*([^-]+?)\s*-/);
    if (betweenDashes) return titleCase(betweenDashes[1]);

    return titleCase(
      normalized
        .replace(/^chicken\s*-?\s*/i, '')
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
  }

  function titleCase(value) {
    return value
      .toLowerCase()
      .replace(/\b[a-z]/g, (char) => char.toUpperCase());
  }

  function getScoreLabel(scoreNum) {
    if (scoreNum >= 7) return 'Good choice';
    if (scoreNum >= 4) return 'Moderate';
    return 'Limit';
  }

  function getSimpleExplanation(dish, advisory) {
    return advisory['Nutritional Profile'] || advisory['Recommendation'] || `${dish} can fit into a Filipino meal when the portion is reasonable.`;
  }

  function getSimpleAdvice(advisory = {}) {
    return [
      ['Watch', advisory['Health Risk'] || 'Portion size and preparation method'],
      ['Pair with', advisory['Recommendation'] || 'Water and a balanced side'],
      ['Better choice', advisory['Healthier Alternative'] || 'Lighter cooking methods']
    ];
  }

  // Renders the box around detected items on the preview
  function drawBoundingBox(bbox, label) {
    const rect = getBoundingBoxRect(bbox, preview, preview.naturalWidth, preview.naturalHeight);
    if (!rect.width || !rect.height) return;

    const box = document.createElement('div');
    box.className = 'bounding-box';
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    const labelEl = document.createElement('div');
    labelEl.className = 'bounding-box-label';
    labelEl.innerText = label;

    box.appendChild(labelEl);
    boundingBoxContainer.appendChild(box);
  }

  // The main button logic for analyzing an uploaded image
  analyzeBtn.addEventListener('click', async () => {
    if (!currentFile) return;

    analyzeBtn.disabled = true;
    analyzeBtn.innerText = 'Analyzing...';

    scanningLaser.style.display = 'block';
    scanningOverlay.style.display = 'block';
    resultsDiv.classList.remove('is-visible');
    resultsDiv.innerHTML = '';
    boundingBoxContainer.innerHTML = '';
    window.speechSynthesis?.cancel();

    const formData = new FormData();
    formData.append('file', currentFile);

    try {
      const res = await fetch(`${apiBaseUrl}/analyze`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`Analyze request failed: ${res.status}`);
      const data = await res.json();

      scanningLaser.style.display = 'none';
      scanningOverlay.style.display = 'none';
      analyzeBtn.innerText = 'Analyze again';
      resultsDiv.classList.add('is-visible');
      workspace.classList.remove('no-results');
      rightColumn.classList.add('has-results');

      if (!data.detections || data.detections.length === 0) {
        lastScanDetails = {
          fileName: currentFile?.name || 'Uploaded image',
          imageWidth: preview.naturalWidth || 0,
          imageHeight: preview.naturalHeight || 0,
          model: data.model || 'YOLO',
          inferenceMs: data.inference_ms ?? 'N/A',
          primaryDish: 'No dish detected',
          primaryConfidence: 0,
          healthScore: 'N/A',
          healthLabel: 'No result',
          detections: []
        };
        resultsDiv.innerHTML = `
          <div class="no-detect">
            <p>No Filipino dish detected. Try a clearer photo with the full plate in view.</p>
            <button class="btn-secondary details-btn" id="openMetricsBtn" type="button">View scan details</button>
          </div>
        `;
        document.getElementById('openMetricsBtn').addEventListener('click', openMetricsModal);
        analyzeBtn.disabled = false;
        return;
      }

      const det = data.detections[0];
      const dishName = cleanFoodName(det.dish);
      const advisory = det.advisory || {};
      const scoreText = advisory['Health Score'] || '5/10';
      const scoreNum = Number.parseInt(scoreText, 10) || 5;
      const scoreLabel = getScoreLabel(scoreNum);
      const explanation = getSimpleExplanation(dishName, advisory);
      lastScanDetails = {
        fileName: currentFile?.name || 'Uploaded image',
        imageWidth: preview.naturalWidth || 0,
        imageHeight: preview.naturalHeight || 0,
        model: data.model || 'YOLO',
        inferenceMs: data.inference_ms ?? 'N/A',
        primaryDish: dishName,
        primaryConfidence: det.confidence,
        healthScore: scoreText,
        healthLabel: scoreLabel,
        detections: data.detections
      };
      mealContext = {
        foodName: dishName,
        confidence: det.confidence,
        healthScore: scoreText,
        healthLabel: scoreLabel,
        advice: {
          watch: advisory['Health Risk'] || '',
          pairWith: advisory['Recommendation'] || '',
          betterChoice: advisory['Healthier Alternative'] || ''
        }
      };
      resetYobabMemory();
      const adviceRows = getSimpleAdvice(advisory)
        .map(([label, text]) => `
          <div class="advice-item">
            <strong>${label}</strong>
            <span>${text}</span>
          </div>
        `)
        .join('');

      if (det.bbox) {
        setTimeout(() => {
          drawBoundingBox(det.bbox, `AI detected: ${dishName}`);
        }, 300);
      }
      scannerCard.classList.add('has-result');
      scanTitle.textContent = 'AI detected your ulam';
      scanSubtitle.textContent = dishName;
      imageDetectionPill.textContent = `AI detected: ${dishName}`;

      resultsDiv.innerHTML = `
        <article class="result-card">
          <div class="result-topline">
            <div class="result-title">
              <p class="eyebrow">Detected food</p>
              <h2>${dishName}</h2>
            </div>
            <div class="result-actions">
              <div class="confidence-badge">${det.confidence}% match</div>
              <button class="btn-secondary details-btn" id="openMetricsBtn" type="button">View scan details</button>
            </div>
          </div>

          <div class="score-row">
            <p class="eyebrow">Health score</p>
            <div class="score-inline">
              <div class="score-value">${scoreNum}<small>/10</small></div>
              <span class="label-badge">${scoreLabel}</span>
            </div>
          </div>

          <p class="result-copy" id="resultExplanation"></p>
        </article>

        <article class="advice-card">
          <h3>Simple advice</h3>
          <div class="advice-list">
            ${adviceRows}
          </div>
        </article>

        <article class="ask-card" data-streaming="false">
          <div class="ask-header">
            <h3>Ask Yobab</h3>
            <span class="ai-live-dot">Ready</span>
          </div>
          <p class="ask-helper">Ask about portions, rice, sodium, health risks, or healthier swaps.</p>
          <div class="follow-up-row"></div>
          <form class="chat-composer" data-dish="${dishName}">
            <input class="chat-input" type="text" placeholder="Ask about this meal..." autocomplete="off">
            <button class="chat-send" type="submit">Send</button>
          </form>
          <div class="answer-preview is-hidden">
            <h4>Yobab says</h4>
            <p class="answer-copy"></p>
          </div>
          <button class="btn-secondary open-chat-btn" id="openNutriChatBtn" type="button">Open Yobab Chat</button>
        </article>
      `;

      const askCard = resultsDiv.querySelector('.ask-card');
      attachChatComposer(askCard, dishName);
      renderFollowUps(askCard.querySelector('.follow-up-row'), dishName);
      document.getElementById('openNutriChatBtn').addEventListener('click', openFullNutriChat);
      document.getElementById('openMetricsBtn').addEventListener('click', openMetricsModal);
      typeText(document.getElementById('resultExplanation'), explanation);

    } catch (err) {
      scanningLaser.style.display = 'none';
      scanningOverlay.style.display = 'none';
      analyzeBtn.innerText = `Analyze dish`;
      resultsDiv.classList.add('is-visible');
      workspace.classList.remove('no-results');
      rightColumn.classList.add('has-results');
      resultsDiv.innerHTML = `
        <div class="no-detect">Error connecting to server. Is it running?</div>
      `;
    }

    analyzeBtn.disabled = false;
  });

});
