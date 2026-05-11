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

  let currentFile = null;
  let stream = null;
  let scanInterval = null;
  let isScanning = false;
  let liveScanFailures = 0;
  let currentLiveDish = '';
  let mealContext = null;

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
      setCameraStatus(
        liveScanFailures >= 2 ? 'Scanner cannot reach the server. Camera is still on.' : 'Scanning...',
        liveScanFailures >= 2
      );
    } finally {
      isScanning = false;
    }
  }

  function drawLiveBoundingBox(bbox) {
    const videoWidth = cameraFeed.clientWidth;
    const videoHeight = cameraFeed.clientHeight;
    // Calculate aspect ratios to map bounding box correctly if object-fit: cover is used.
    // For simplicity, assuming the video element dimensions match the aspect ratio of the feed.
    const x1 = bbox[0] * videoWidth;
    const y1 = bbox[1] * videoHeight;
    const x2 = bbox[2] * videoWidth;
    const y2 = bbox[3] * videoHeight;

    const width = x2 - x1;
    const height = y2 - y1;

    const box = document.createElement('div');
    box.className = 'live-bounding-box';
    box.style.left = `${x1}px`;
    box.style.top = `${y1}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;

    liveBoundingBoxContainer.appendChild(box);
  }

  function renderArFloatingCard(det) {
    const advisory = det.advisory;
    const scoreText = advisory['Health Score'] || '5/10';
    const scoreNum = parseInt(scoreText);

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
      <div class="ar-details">
        <p class="ar-thinking">Analyzing nutritional content of ${det.dish}...</p>
        <p class="ar-ai-copy"></p>
      </div>
    `;
    liveArOverlayContainer.appendChild(card);
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
      target.textContent = `Yobab could not stream right now, but ${dish} is best handled with a modest portion, gulay or sabaw, and water. Avoid extra gravy or salty sawsawan.`;
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

    try {
      const formData = new FormData();
      formData.append('dish', mealContext?.foodName || 'Fried Chicken');
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
      console.error('Yobab stream failed, using local fallback:', error);
      answer = getYobabReply(userMessage, historyBeforeUserMessage, mealContext);
      hooks.onStart?.();
      await hooks.onToken?.(answer, answer);
    }

    answer = limitSentences(answer.trim(), 5);
    messages.push({ role: 'assistant', content: answer });
    hooks.onDone?.(answer);
    return answer;
  }

  // Local fallback logic if the AI server is down
  function getYobabReply(userMessage, messages, mealContext) {
    const normalized = userMessage.toLowerCase();
    const dish = mealContext?.foodName || 'Fried Chicken';

    if (!isNutritionQuestion(normalized) && !isMealFollowUp(normalized, messages)) {
      return 'I’m here for ulam and nutrition questions only. Ask me about Fried Chicken, portions, rice, sodium, diabetes, hypertension, or healthier swaps.';
    }

    if (isMealFollowUp(normalized, messages) && (
      normalized === 'why' ||
      normalized === 'why?' ||
      normalized.includes('how come') ||
      normalized.includes('explain') ||
      normalized.includes('what do you mean') ||
      normalized.includes('are you sure') ||
      normalized === 'sure' ||
      normalized.includes('really') ||
      normalized.includes('is that true') ||
      normalized.includes('confirm')
    )) {
      return `Yes, I’m sure about the general guidance. ${dish} tends to be heavier because of oil, sodium, and fried coating, so gulay, sabaw, water, and moderate kanin help balance the meal. It is not a ban, just a smarter plate setup.`;
    }

    if (normalized.includes('skin') || normalized.includes('remove')) {
      return `Removing the skin helps reduce some oil and calories from ${dish}. Still bantayan the portion, because fried coating and sodium can still add up. Pair it with gulay or sabaw and keep the kanin reasonable.`;
    }

    if (normalized.includes('diabetes') || normalized.includes('blood sugar')) {
      return `${dish} can fit sometimes, but watch the kanin more closely. Keep rice reasonable, add gulay or sabaw, and skip sweet drinks. Tiny plate math, big difference.`;
    }

    if (normalized.includes('hypertension') || normalized.includes('blood pressure') || normalized.includes('sodium') || normalized.includes('salt')) {
      return `${dish} can be salty, especially with gravy or sawsawan. Keep the portion modest, choose water, and pair it with gulay or sabaw. Your blood pressure does not need extra drama.`;
    }

    if (normalized.includes('pair') || normalized.includes('with') || normalized.includes('rice') || normalized.includes('kanin')) {
      return `Pair ${dish} with gulay or sabaw, water, and around 1 cup of rice. Go easy on gravy and salty sawsawan. Balanced plate, less food coma.`;
    }

    if (normalized.includes('often') || normalized.includes('everyday') || normalized.includes('every day') || normalized.includes('daily') || normalized.includes('araw')) {
      return `${dish} is fine occasionally, but not pang-araw-araw. The main things to bantayan are oil, sodium, and portion size. Pair it with gulay or sabaw, keep rice reasonable, and skip extra gravy or salty sawsawan.`;
    }

    if (normalized.includes('swap') || normalized.includes('healthier') || normalized.includes('better')) {
      return `A better choice would be inihaw, tinola, air-fried, or less oily manok. Keep the flavor, reduce the oil and sodium, and add gulay on the side. Still masarap, just less heavy.`;
    }

    return `${dish} is fine occasionally, but not pang-araw-araw. Watch oil, sodium, and portion size. Pair it with gulay or sabaw, keep rice reasonable, and skip extra gravy or salty sawsawan.`;
  }

  function isNutritionQuestion(text) {
    return [
      'ulam',
      'nutrition',
      'nutri',
      'yobab',
      'portion',
      'rice',
      'kanin',
      'sodium',
      'salt',
      'diabetes',
      'hypertension',
      'blood pressure',
      'blood sugar',
      'health',
      'healthy',
      'healthier',
      'swap',
      'often',
      'daily',
      'everyday',
      'araw',
      'pair',
      'gulay',
      'sabaw',
      'gravy',
      'sawsawan',
      'oil',
      'fried',
      'eat'
    ].some((keyword) => text.includes(keyword));
  }

  function isMealFollowUp(text, history = messages) {
    const compact = text.trim().replace(/\s+/g, ' ');
    const followUps = [
      'why',
      'why?',
      'why not',
      'how come',
      'what do you mean',
      'explain',
      'explain more',
      'what about rice',
      'what about gravy',
      'what about removing the skin',
      'is that bad',
      'can i eat more',
      'how often',
      'what if every day',
      'why 1 cup',
      'why avoid sawsawan',
      'are you sure',
      'sure',
      'really',
      'is that true',
      'can you confirm',
      'confirm'
    ];
    const hasAssistantMealContext = history.some((message) => (
      message.role === 'assistant' &&
      /(meal|ulam|rice|kanin|gulay|sabaw|sodium|portion|fried|gravy|sawsawan|chicken)/i.test(message.content)
    ));

    return hasAssistantMealContext && followUps.some((term) => compact.includes(term));
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
    const lowerDish = dish.toLowerCase();
    if (lowerDish.includes('fried chicken')) {
      return 'Fried chicken can be enjoyed occasionally, but it is likely higher in oil and sodium. Keep the portion modest and balance it with gulay, sabaw, water, and a reasonable amount of rice.';
    }

    return advisory['Recommendation'] || `${dish} can fit into a Filipino meal when the portion is reasonable. Balance the ulam with gulay, sabaw, water, and about 1 cup of rice.`;
  }

  function getSimpleAdvice(dish) {
    const lowerDish = dish.toLowerCase();
    const betterChoice = lowerDish.includes('chicken')
      ? 'Inihaw, tinola, air-fried, or less oily manok'
      : 'Inihaw, tinola, broth-based, steamed, or less oily versions';

    return [
      ['Watch', 'Oil, sodium, and large portions'],
      ['Pair with', 'Gulay, sabaw, water, and around 1 cup rice'],
      ['Better choice', betterChoice]
    ];
  }

  // Renders the box around detected items on the preview
  function drawBoundingBox(bbox, label) {
    const imgWidth = preview.clientWidth;
    const imgHeight = preview.clientHeight;

    const x1 = bbox[0] * imgWidth;
    const y1 = bbox[1] * imgHeight;
    const x2 = bbox[2] * imgWidth;
    const y2 = bbox[3] * imgHeight;

    const width = x2 - x1;
    const height = y2 - y1;

    const box = document.createElement('div');
    box.className = 'bounding-box';
    box.style.left = `${x1}px`;
    box.style.top = `${y1}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;

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
        resultsDiv.innerHTML = `
          <div class="no-detect">No Filipino dish detected. Try a clearer photo with the full plate in view.</div>
        `;
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
      mealContext = {
        foodName: dishName,
        confidence: det.confidence,
        healthScore: scoreText,
        healthLabel: scoreLabel,
        advice: {
          watch: 'Oil, sodium, and large portions',
          pairWith: 'Gulay, sabaw, water, and around 1 cup rice',
          betterChoice: getSimpleAdvice(dishName)[2][1]
        }
      };
      resetYobabMemory();
      const adviceRows = getSimpleAdvice(dishName)
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
            <div class="confidence-badge">${det.confidence}% match</div>
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
