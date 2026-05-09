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
  let ttsSpeech = new SpeechSynthesisUtterance();
  let isSpeaking = false;
  let availableVoices = [];

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

  // Camera & AR Live Scanner Logic
  cameraBtn.addEventListener('click', async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      cameraFeed.srcObject = stream;
      cameraModal.classList.add('open');
      
      liveScanningLaser.style.display = 'block';
      liveScanningOverlay.style.display = 'block';
      liveBoundingBoxContainer.innerHTML = '';
      liveArOverlayContainer.innerHTML = '';
      
      // Start Live Scan Loop
      scanInterval = setInterval(scanLiveFrame, 2000);
    } catch (err) {
      alert("Camera access denied or unavailable.");
    }
  });

  async function scanLiveFrame() {
    if (!stream || isScanning) return;
    isScanning = true;

    // Capture frame to hidden canvas
    snapshot.width = cameraFeed.videoWidth;
    snapshot.height = cameraFeed.videoHeight;
    const ctx = snapshot.getContext('2d');
    ctx.drawImage(cameraFeed, 0, 0);

    snapshot.toBlob(async (blob) => {
      const formData = new FormData();
      formData.append('file', blob, 'frame.jpg');

      try {
        const res = await fetch('http://127.0.0.1:8000/analyze', { method: 'POST', body: formData });
        const data = await res.json();
        
        liveBoundingBoxContainer.innerHTML = '';
        liveArOverlayContainer.innerHTML = '';

        if (data.detections && data.detections.length > 0) {
          // Render AR Overlays for the first detected dish to keep it clean
          const det = data.detections[0]; 
          
          if (det.bbox) {
            drawLiveBoundingBox(det.bbox);
          }
          
          renderArFloatingCard(det);
        }
      } catch (e) {
        console.error("Live scan error:", e);
      } finally {
        isScanning = false;
      }
    }, 'image/jpeg');
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
        <h4>${det.dish}</h4>
        <span class="ar-confidence">${det.confidence}%</span>
      </div>
      <div class="ar-stats">
        <div class="ar-stat">
          <div class="ar-stat-label">Health Score</div>
          <div class="ar-stat-value" style="color: ${scoreColor}">${scoreNum}/10 <span style="font-size:0.7rem; display:block">${scoreDesc}</span></div>
        </div>
      </div>
      <div class="ar-details">
        <p><strong>Nutrition:</strong> ${advisory['Nutritional Profile']}</p>
        <p><strong>Risk:</strong> ${advisory['Health Risk']}</p>
        <p><strong>Recommendation:</strong> ${advisory['Recommendation']}</p>
        <p><strong>Alternative:</strong> ${advisory['Healthier Alternative']}</p>
      </div>
    `;
    liveArOverlayContainer.appendChild(card);
  }

  closeCamera.addEventListener('click', stopCamera);

  function stopCamera() {
    if (scanInterval) {
      clearInterval(scanInterval);
      scanInterval = null;
    }
    isScanning = false;
    liveScanningLaser.style.display = 'none';
    liveScanningOverlay.style.display = 'none';
    liveBoundingBoxContainer.innerHTML = '';
    liveArOverlayContainer.innerHTML = '';

    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
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
      const res = await fetch('http://127.0.0.1:8000/analyze', { method: 'POST', body: formData });
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

          <div class="result-item fade-in" style="animation-delay: 0.3s">
            <div class="advisory-label"><span>🌿</span> Nutrition</div>
            <div class="advisory-content">${advisory['Nutritional Profile'] || 'N/A'}</div>
          </div>

          <div class="result-item fade-in" style="animation-delay: 0.4s">
            <div class="advisory-label"><span>⚠️</span> Health Risk</div>
            <div class="advisory-content">${advisory['Health Risk'] || 'N/A'}</div>
          </div>

          <div class="result-item fade-in" style="animation-delay: 0.5s">
            <div class="advisory-label"><span>💡</span> Recommendation</div>
            <div class="advisory-content">${advisory['Recommendation'] || 'N/A'}</div>
          </div>

          <div class="result-item fade-in" style="animation-delay: 0.6s">
            <div class="advisory-label"><span>🥗</span> Alternative</div>
            <div class="advisory-content">${advisory['Healthier Alternative'] || 'N/A'}</div>
          </div>
        `;
        exportArea.appendChild(grid);
      });

      resultsDiv.appendChild(exportArea);

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
