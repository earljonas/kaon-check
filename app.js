document.addEventListener('DOMContentLoaded', () => {
  const uploadZone = document.getElementById('uploadZone');
  const fileInput = document.getElementById('fileInput');
  const preview = document.getElementById('preview');
  const previewContainer = document.getElementById('previewContainer');
  const analyzeBtn = document.getElementById('analyzeBtn');
  const cameraBtn = document.getElementById('cameraBtn');
  const resultsDiv = document.getElementById('results');
  const boundingBoxContainer = document.getElementById('boundingBoxContainer');
  const scanningLaser = document.getElementById('scanningLaser');
  const scanningOverlay = document.getElementById('scanningOverlay');
  
  // Camera Elements
  const cameraModal = document.getElementById('cameraModal');
  const cameraFeed = document.getElementById('cameraFeed');
  const cameraStatus = document.getElementById('cameraStatus');
  const closeCamera = document.getElementById('closeCamera');
  const snapshot = document.getElementById('snapshot');

  // AR Live Scanner Elements
  const liveScanningLaser = document.getElementById('liveScanningLaser');
  const liveScanningOverlay = document.getElementById('liveScanningOverlay');
  const liveBoundingBoxContainer = document.getElementById('liveBoundingBoxContainer');
  const liveArOverlayContainer = document.getElementById('liveArOverlayContainer');

  let currentFile = null;
  let stream = null;
  let scanInterval = null;
  let isScanning = false;
  let liveScanFailures = 0;
  let currentLiveDish = '';
  const chatHistories = new Map();
  let ttsSpeech = new SpeechSynthesisUtterance();
  let isSpeaking = false;
  let availableVoices = [];

  const apiBaseUrl = window.location.port === '8000' ? '' : 'http://127.0.0.1:8000';

  // Browsers load voices asynchronously, so we must wait for them to load
  window.speechSynthesis.onvoiceschanged = () => {
    availableVoices = window.speechSynthesis.getVoices();
  };

  uploadZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) setFile(file);
  });

  function resetApp() {
    window.speechSynthesis.cancel();
    uploadZone.style.display = 'block';
    previewContainer.style.display = 'none';
    resultsDiv.style.display = 'none';
    currentFile = null;
    analyzeBtn.disabled = true;
  }

  function setFile(file) {
    currentFile = file;
    const url = URL.createObjectURL(file);
    preview.src = url;
    
    uploadZone.style.display = 'none';
    previewContainer.style.display = 'block';
    
    analyzeBtn.disabled = false;
    resultsDiv.style.display = 'none';
    resultsDiv.innerHTML = '';
    boundingBoxContainer.innerHTML = '';
    window.speechSynthesis.cancel();
    isSpeaking = false;
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

  // Camera & AR Live Scanner 
  cameraBtn.addEventListener('click', async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API is unavailable.');
      }

      cameraBtn.disabled = true;
      cameraModal.classList.add('open');
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
      
      // Start Live Scan Loop
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
      // Capture frame to hidden canvas
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
        // Render AR Overlays for the first detected dish to keep it clean
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
    
    let scoreColor = 'var(--score-poor)';
    let scoreDesc = 'High Risk';
    if (scoreNum >= 7) { scoreColor = 'var(--score-excellent)'; scoreDesc = 'Healthy Choice'; }
    else if (scoreNum >= 4) { scoreColor = 'var(--score-moderate)'; scoreDesc = 'Moderate'; }

    const card = document.createElement('div');
    card.className = 'ar-floating-card';
    card.innerHTML = `
      <div class="ar-dish-header">
        <div>
          <span class="ar-kicker">Nutri scan</span>
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
    streamNutriText(card.querySelector('.ar-ai-copy'), det.dish, '', null, card.querySelector('.ar-thinking'));
  }

  function getFollowUpQuestions(dish) {
    return [
      `Is ${dish} okay if I have hypertension?`,
      `What is a healthier version of ${dish}?`,
      `How often can I eat this?`,
      `What should I pair this with?`
    ];
  }

  function getChatHistory(dish) {
    if (!chatHistories.has(dish)) {
      chatHistories.set(dish, []);
    }
    return chatHistories.get(dish);
  }

  function addChatHistory(dish, role, content) {
    const history = getChatHistory(dish);
    history.push({ role, content });
    if (history.length > 10) {
      history.splice(0, history.length - 10);
    }
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

  async function streamNutriText(target, dish, question = '', followUpContainer = null, thinkingTarget = null, history = []) {
    target.textContent = '';
    target.classList.add('is-streaming');
    if (thinkingTarget) {
      thinkingTarget.textContent = question ? `Nutri is thinking about ${dish}...` : `Analyzing nutritional content of ${dish}...`;
      thinkingTarget.style.display = 'block';
    } else {
      target.textContent = question ? `Nutri is thinking about ${dish}...` : `Analyzing nutritional content of ${dish}...`;
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
      console.error('Nutri stream error:', err);
      if (thinkingTarget) thinkingTarget.style.display = 'none';
      target.textContent = `Nutri could not stream right now, but ${dish} is best handled with a balanced portion, vegetables, and water.`;
    } finally {
      target.classList.remove('is-streaming');
      if (followUpContainer && !question) {
        renderFollowUps(followUpContainer, dish);
      }
    }

    return target.textContent.trim();
  }

  async function sendChatMessage(card, dish, question) {
    const message = question.trim();
    if (!message || card.dataset.streaming === 'true') return;

    const input = card.querySelector('.chat-input');
    const sendButton = card.querySelector('.chat-send');
    const conversation = card.querySelector('.ai-conversation');
    const followUps = card.querySelector('.follow-up-row');
    const historySnapshot = [...getChatHistory(dish)];

    card.dataset.streaming = 'true';
    if (input) input.disabled = true;
    if (sendButton) sendButton.disabled = true;

    const userBubble = document.createElement('div');
    userBubble.className = 'chat-bubble user';
    userBubble.textContent = message;
    conversation.appendChild(userBubble);

    const thinking = document.createElement('div');
    thinking.className = 'ai-thinking';
    thinking.textContent = `Nutri is thinking about ${dish}...`;
    conversation.appendChild(thinking);

    const replyBubble = document.createElement('div');
    replyBubble.className = 'chat-bubble assistant';
    conversation.appendChild(replyBubble);
    if (followUps) followUps.innerHTML = '';

    const answer = await streamNutriText(replyBubble, dish, message, null, thinking, historySnapshot);
    addChatHistory(dish, 'user', message);
    if (answer) addChatHistory(dish, 'assistant', answer);
    renderFollowUps(followUps, dish);

    card.dataset.streaming = 'false';
    if (input) {
      input.disabled = false;
      input.value = '';
      input.focus();
    }
    if (sendButton) sendButton.disabled = false;
    conversation.scrollTop = conversation.scrollHeight;
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
        const card = button.closest('.ai-advisor-card');
        await sendChatMessage(card, dish, question);
      });
      container.appendChild(button);
    });
  }

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
  }

  // Draw Bounding Box
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

  // Analyze Image
  analyzeBtn.addEventListener('click', async () => {
    if (!currentFile) return;

    analyzeBtn.disabled = true;
    analyzeBtn.innerText = 'Analyzing...';
    
    scanningLaser.style.display = 'block';
    scanningOverlay.style.display = 'block';
    resultsDiv.style.display = 'none';
    resultsDiv.innerHTML = '';
    boundingBoxContainer.innerHTML = '';
    window.speechSynthesis.cancel();

    const formData = new FormData();
    formData.append('file', currentFile);

    try {
      const res = await fetch(`${apiBaseUrl}/analyze`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`Analyze request failed: ${res.status}`);
      const data = await res.json();

      scanningLaser.style.display = 'none';
      scanningOverlay.style.display = 'none';
      analyzeBtn.innerText = 'Analyze Dish';
      resultsDiv.style.display = 'block';

      if (!data.detections || data.detections.length === 0) {
        resultsDiv.innerHTML = `
          <div class="no-detect">No Filipino dish detected. Try another photo.</div>
          <div class="action-bar">
            <button class="btn-primary" id="noDetectResetBtn">Try Another Photo</button>
          </div>
        `;
        document.getElementById('noDetectResetBtn').addEventListener('click', resetApp);
        analyzeBtn.disabled = false;
        return;
      }

      const exportArea = document.createElement('div');
      exportArea.className = 'exportable-area';
      exportArea.id = 'exportArea';
      chatHistories.clear();
      
      let fullSpeechText = "";

      data.detections.forEach((det) => {
        if (det.bbox) {
          setTimeout(() => {
            drawBoundingBox(det.bbox, `${det.dish} (${det.confidence}%)`);
          }, 300);
        }

        const advisory = det.advisory;
        const scoreText = advisory['Health Score'] || '5/10';
        const scoreNum = parseInt(scoreText);
        const scorePercent = (scoreNum / 10) * 100;
        
        let scoreColor = 'var(--score-poor)';
        let scoreDesc = 'High Risk';
        if (scoreNum >= 7) { scoreColor = 'var(--score-excellent)'; scoreDesc = 'Healthy Choice'; }
        else if (scoreNum >= 4) { scoreColor = 'var(--score-moderate)'; scoreDesc = 'Moderate'; }

        const r = 50;
        const circumference = 2 * Math.PI * r;
        const offset = circumference - (scorePercent / 100) * circumference;

        fullSpeechText += `Detected ${det.dish}. Health Score: ${scoreText}. Nutritional Profile: ${advisory['Nutritional Profile']}. Health Risk: ${advisory['Health Risk']}. Recommendation: ${advisory['Recommendation']}. Healthier Alternative: ${advisory['Healthier Alternative']}. `;

        const grid = document.createElement('div');
        grid.className = 'results-grid';
        grid.innerHTML = `
          <div class="result-item full-width fade-in" style="animation-delay: 0.1s">
            <div class="dish-header">
              <h2>${det.dish}</h2>
              <div class="confidence-badge">${det.confidence}% Match</div>
            </div>
          </div>

          <div class="result-item full-width score-wrapper fade-in" style="animation-delay: 0.2s">
            <div class="score-ring-container">
              <svg class="score-ring" viewBox="0 0 120 120">
                <circle class="ring-bg" cx="60" cy="60" r="50"></circle>
                <circle class="ring-fill" cx="60" cy="60" r="50" style="stroke: ${scoreColor}; stroke-dashoffset: ${circumference};" data-offset="${offset}"></circle>
              </svg>
              <div class="score-value" style="color: ${scoreColor}">${scoreNum}</div>
            </div>
            <div class="score-text">
              <h4>Health Score</h4>
              <p style="color: ${scoreColor}">${scoreDesc}</p>
            </div>
          </div>

          <div class="result-item full-width ai-advisor-card fade-in" style="animation-delay: 0.3s">
            <div class="ai-advisor-header">
              <div>
                <span class="ai-kicker">Nutri advisory</span>
                <h3>Natural nutrition guidance</h3>
              </div>
              <span class="ai-live-dot">Live</span>
            </div>
            <div class="ai-conversation">
              <div class="ai-thinking">Analyzing nutritional content of ${det.dish}...</div>
              <div class="chat-bubble assistant streaming-text" data-dish="${det.dish}"></div>
            </div>
            <div class="follow-up-row" data-followups="${det.dish}"></div>
            <form class="chat-composer" data-dish="${det.dish}">
              <input class="chat-input" type="text" placeholder="Ask Nutri about portions, health risks, or healthier swaps" autocomplete="off">
              <button class="chat-send" type="submit">Send</button>
            </form>
          </div>
        `;
        exportArea.appendChild(grid);
      });

      resultsDiv.appendChild(exportArea);

      document.querySelectorAll('.streaming-text').forEach((streamTarget) => {
        const dish = streamTarget.dataset.dish;
        const card = streamTarget.closest('.ai-advisor-card');
        const followUps = card.querySelector('.follow-up-row');
        const thinking = card.querySelector('.ai-thinking');
        attachChatComposer(card, dish);
        streamNutriText(streamTarget, dish, '', followUps, thinking, []).then((answer) => {
          if (answer) addChatHistory(dish, 'assistant', answer);
        });
      });

      // Actions Bar
      const actionBar = document.createElement('div');
      actionBar.className = 'action-bar';
      actionBar.innerHTML = `
        <button class="btn-secondary" id="ttsBtn">Read Advisory</button>
        <button class="btn-secondary" id="exportBtn">Save Report</button>
        <button class="btn-secondary btn-icon" id="resetBtn" title="New Scan">✕</button>
      `;
      resultsDiv.appendChild(actionBar);

      setTimeout(() => {
        document.querySelectorAll('.ring-fill').forEach(ring => {
          ring.style.strokeDashoffset = ring.getAttribute('data-offset');
        });
      }, 50);

      // Attach Actions
      document.getElementById('resetBtn').addEventListener('click', resetApp);

      document.getElementById('ttsBtn').addEventListener('click', () => {
        if (isSpeaking) {
          window.speechSynthesis.cancel();
          isSpeaking = false;
          document.getElementById('ttsBtn').innerText = 'Read Advisory';
        } else {
          // If voices haven't loaded yet, try fetching them again
          if (availableVoices.length === 0) {
            availableVoices = window.speechSynthesis.getVoices();
          }

          // Search for a female voice
          const preferredVoice = availableVoices.find(voice => 
            voice.name.includes('Female')
          );

          if (preferredVoice) {
            ttsSpeech.voice = preferredVoice;
          }

          // Optional: You can also tweak pitch and speed here
          // ttsSpeech.pitch = 1.0; // Range: 0 to 2
          // ttsSpeech.rate = 0.95;  // Range: 0.1 to 10 (lower is slower)

          ttsSpeech.text = fullSpeechText;
          window.speechSynthesis.speak(ttsSpeech);
          isSpeaking = true;
          document.getElementById('ttsBtn').innerText = 'Stop Reading';
        }
      });

      ttsSpeech.onend = () => {
        isSpeaking = false;
        const btn = document.getElementById('ttsBtn');
        if(btn) btn.innerText = 'Read Advisory';
      };

      document.getElementById('exportBtn').addEventListener('click', async () => {
        const btn = document.getElementById('exportBtn');
        const originalText = btn.innerText;
        btn.innerText = "Generating...";
        try {
          const canvas = await html2canvas(document.getElementById('exportArea'), {
            backgroundColor: '#FDFBF7',
            scale: 2
          });
          const link = document.createElement('a');
          link.download = 'kaoncheck-advisory.png';
          link.href = canvas.toDataURL();
          link.click();
        } catch (e) {
          console.error("Export failed", e);
        }
        btn.innerText = originalText;
      });

    } catch (err) {
      scanningLaser.style.display = 'none';
      scanningOverlay.style.display = 'none';
      analyzeBtn.innerText = `Analyze Dish`;
      resultsDiv.style.display = 'block';
      resultsDiv.innerHTML = `
        <div class="no-detect">Error connecting to server. Is it running?</div>
        <div class="action-bar">
          <button class="btn-primary" id="errorResetBtn">Try Again</button>
        </div>
      `;
      document.getElementById('errorResetBtn').addEventListener('click', resetApp);
    }

    analyzeBtn.disabled = false;
  });

});
