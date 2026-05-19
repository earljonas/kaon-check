# Final QA/QC System Audit Report: KaonCheck

After conducting a comprehensive end-to-end review of the KaonCheck Filipino food recognition application, I have identified several issues that must be addressed before the system is considered production-ready for your live demo.

> [!WARNING]
> **Status: NOT DEMO-READY**
> The application currently violates a core requirement: **"No mock, placeholder, or hardcoded data remains—everything must use real data sources."** Significant amounts of hardcoded mock data exist on the frontend that override the real AI responses from the backend.

Below is the detailed breakdown of the issues found, classified by severity, along with actionable fixes.

---

## 🛑 CRITICAL SEVERITY

### 1. Hardcoded UI Advice Data Bypassing Backend API
**Issue:**
The `app.js` frontend actively ignores the real `advisory` object returned by the backend `/analyze` endpoint. Instead, the `getSimpleAdvice(dish)` function hardcodes the nutrition advice for **all** dishes to:
- *Watch:* "Oil, sodium, and large portions"
- *Pair with:* "Gulay, sabaw, water, and around 1 cup rice"

Additionally, `getSimpleExplanation()` contains a hardcoded `if` statement specifically checking for "fried chicken" to return a mock explanation. This defeats the purpose of the backend AI analysis and guarantees incorrect, static advice for many dishes during a live demo.

**Actionable Fix:**
Modify `app.js` to utilize the data coming directly from the backend.
```javascript
// Remove hardcoded text and map to the advisory object from nlp.py:
function getSimpleAdvice(dish, advisory) {
  return [
    ['Watch', advisory['Health Risk'] || 'Portion size'],
    ['Pair with', advisory['Recommendation'] || 'Water and a balanced side'],
    ['Better choice', advisory['Healthier Alternative'] || 'Lighter cooking methods']
  ];
}
```

### 2. Hardcoded Default Dish Context ("Fried Chicken")
**Issue:**
In `app.js` (Lines 472 and 510), when sending messages to the Yobab AI chatbot stream, if `mealContext` is undefined, the application hardcodes the dish as `'Fried Chicken'`. If a user interacts with the chat before a scan is fully registered, the AI will incorrectly think they are asking about Fried Chicken.
```javascript
formData.append('dish', mealContext?.foodName || 'Fried Chicken');
```

**Actionable Fix:**
Remove the `'Fried Chicken'` hardcoded string. If there is no meal context yet, the dish parameter should be passed as empty or a generic `'this dish'`, and the chat should prompt the user to scan a meal first.

---

## 🟠 MAJOR SEVERITY

### 3. Duplicate Hardcoded AI Fallback in Frontend (`app.js`)
**Issue:**
The frontend `app.js` contains a massive `getYobabReply` function (spanning ~50 lines) that serves as a local fallback if the AI streaming endpoint fails. This function manually checks for keywords like `'diabetes'`, `'hypertension'`, and `'skin'` and returns hardcoded mock strings.

Not only does this violate the "no hardcoded data" rule, but it is also redundant because the backend (`nlp.py`) already contains a robust `_fallback_reply()` function for this exact scenario. If the backend server fails entirely (e.g. 502 Bad Gateway), the frontend should show a network error, not pretend to be a functioning AI using mock string matching.

**Actionable Fix:**
Delete the `getYobabReply` mock logic from `app.js`. Update the `catch` block in `sendYobabMessage` to correctly inform the user of a network failure:
```javascript
catch (error) {
  console.error('Yobab stream failed:', error);
  answer = "I'm having trouble connecting to the server right now. Please make sure the backend is running.";
  hooks.onStart?.();
  await hooks.onToken?.(answer, answer);
}
```

---

## 🟡 MINOR SEVERITY

### 4. Bounding Box Misalignment in Live Camera Mode
**Issue:**
In `app.js`, the `drawLiveBoundingBox` function calculates coordinates by multiplying bounding box decimals against `cameraFeed.clientWidth` and `cameraFeed.clientHeight`. If the video element uses CSS styling that alters the natural aspect ratio (like `object-fit: cover`), the drawn bounding boxes will drift and not align perfectly with the physical food on the screen during the demo.

**Actionable Fix:**
Calculate the scale multiplier using the video's intrinsic dimensions (`videoWidth` / `videoHeight`) combined with the element's client dimensions to ensure pixel-perfect bounding box alignment.

### 5. Infinite Scanning Loop on Server Disconnect
**Issue:**
If the backend server goes offline while the user is using the "Camera Scanner" mode, `scanLiveFrame` correctly catches the error and increments `liveScanFailures`. However, the `scanInterval` is never cleared. The browser will endlessly fire POST requests to a dead server every 2 seconds, which can cause console bloat and browser lag.

**Actionable Fix:**
If `liveScanFailures >= 3`, explicitly clear the `scanInterval`, disable the scanning laser UI, and prompt the user to restart the server or refresh the page.

---

### Final Verification Verdict

Until **Issues #1 and #2** are resolved, the application contains significant mock logic that overrides your AI components. Once those are corrected to use the real API data, the application will be end-to-end robust and ready for your live class demonstration.

If you would like me to go ahead and implement these fixes in `app.js` so it is 100% demo-ready, please let me know!
