// Antigravity Voice Butler - Self-Contained Content Script (iOS/iPadOS + Desktop Compliant)

(() => {
  // Prevent duplicate injection
  if (window.__antigravityVoiceButlerInjected) {
    const existing = document.getElementById("ag-voice-butler-root");
    if (existing) {
      existing.style.display = existing.style.display === "none" ? "block" : "none";
    }
    return;
  }
  window.__antigravityVoiceButlerInjected = true;

  const DEFAULT_SERVER_URL = "wss://butler.retake.cloud/ws";
  let ws = null;
  let audioContext = null;
  let micStream = null;
  let scriptProcessor = null;
  let isRecording = false;
  let isConnected = false;
  let currentConvId = null;
  let scheduledSources = [];
  let nextStartTime = 0;
  let syncTimer = null;

  // On-screen logging helper for mobile debugging
  function appendLog(msg, color = "#94a3b8") {
    console.log("[VoiceButler]", msg);
    const logBox = document.getElementById("agButlerLogBox");
    if (!logBox) return;
    const item = document.createElement("div");
    item.style.color = color;
    item.style.fontSize = "11px";
    item.style.lineHeight = "1.4";
    item.textContent = "[" + new Date().toLocaleTimeString().split(" ")[0] + "] " + msg;
    logBox.appendChild(item);
    logBox.scrollTop = logBox.scrollHeight;
  }

  // Catch any unhandled window errors and show on-screen
  window.addEventListener("error", (e) => {
    appendLog("Error: " + (e.message || e), "#ef4444");
  });

  // UI Setup
  const root = document.createElement("div");
  root.id = "ag-voice-butler-root";
  root.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
    user-select: none;
  `;

  // Log Console (Collapsible)
  const logCard = document.createElement("div");
  logCard.id = "agButlerLogCard";
  logCard.style.cssText = `
    width: 320px;
    height: 180px;
    background: rgba(15, 23, 42, 0.95);
    border: 1px solid #334155;
    border-radius: 12px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    backdrop-filter: blur(8px);
    transition: all 0.2s ease;
  `;

  const logHdr = document.createElement("div");
  logHdr.style.cssText = `
    padding: 6px 10px;
    background: rgba(30, 41, 59, 0.8);
    border-bottom: 1px solid #334155;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    font-weight: 600;
    color: #94a3b8;
  `;
  logHdr.innerHTML = `
    <span>Butler (Gemini Live Puck)</span>
    <div>
      <span id="agClearLogBtn" style="cursor:pointer;margin-right:8px;">Clear</span>
      <span id="agMinLogBtn" style="cursor:pointer;">▼</span>
    </div>
  `;

  const logBox = document.createElement("div");
  logBox.id = "agButlerLogBox";
  logBox.style.cssText = `
    flex: 1;
    padding: 8px 10px;
    overflow-y: auto;
    font-family: monospace;
    display: flex;
    flex-direction: column;
    gap: 3px;
  `;

  logCard.appendChild(logHdr);
  logCard.appendChild(logBox);

  // Control Bar
  const bar = document.createElement("div");
  bar.style.cssText = "display: flex; align-items: center; gap: 8px;";

  const statusBadge = document.createElement("div");
  statusBadge.id = "agStatusBadge";
  statusBadge.style.cssText = `
    background: rgba(15, 23, 42, 0.85);
    color: #fff;
    padding: 6px 14px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 500;
    border: 1px solid #334155;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;
  statusBadge.textContent = "Connecting to Butler...";

  const micBtn = document.createElement("button");
  micBtn.id = "agMicBtn";
  micBtn.style.cssText = `
    width: 54px;
    height: 54px;
    border-radius: 50%;
    background: #4f46e5;
    border: 2px solid #ffffff;
    box-shadow: 0 4px 16px rgba(79, 70, 229, 0.6);
    font-size: 22px;
    cursor: pointer;
    outline: none;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s ease, background 0.2s ease;
  `;
  micBtn.textContent = "🎙️";

  bar.appendChild(statusBadge);
  bar.appendChild(micBtn);
  root.appendChild(logCard);
  root.appendChild(bar);

  // Safe DOM attachment
  const attachRoot = () => {
    if (document.body) {
      document.body.appendChild(root);
    } else if (document.documentElement) {
      document.documentElement.appendChild(root);
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attachRoot);
  } else {
    attachRoot();
  }

  // Collapse / Clear handlers
  let isMin = false;
  document.getElementById("agMinLogBtn").onclick = () => {
    isMin = !isMin;
    logBox.style.display = isMin ? "none" : "flex";
    logCard.style.height = isMin ? "28px" : "180px";
    document.getElementById("agMinLogBtn").textContent = isMin ? "▲" : "▼";
  };
  document.getElementById("agClearLogBtn").onclick = () => {
    logBox.textContent = "";
  };

  appendLog("Butler extension script mounted", "#38bdf8");

  // Audio Processing Helpers
  function downsample(buffer, sampleRate, outRate) {
    if (sampleRate === outRate) return buffer;
    const ratio = sampleRate / outRate;
    const newLen = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLen);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0, count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = count ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  function toInt16PCM(float32Array) {
    const buffer = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      buffer[i] = Math.min(1, Math.max(-1, float32Array[i])) * 0x7fff;
    }
    return buffer.buffer;
  }

  function stopAudioPlayback() {
    for (let i = 0; i < scheduledSources.length; i++) {
      try { scheduledSources[i].stop(); } catch (_) {}
    }
    scheduledSources = [];
    if (audioContext) nextStartTime = audioContext.currentTime;
  }

  function play24kPCM(arrayBuffer) {
    if (!audioContext) return;
    if (audioContext.state === "suspended") audioContext.resume();
    const pcm = new Int16Array(arrayBuffer);
    const floatArray = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) floatArray[i] = pcm[i] / 32768.0;

    const audioBuf = audioContext.createBuffer(1, floatArray.length, 24000);
    audioBuf.getChannelData(0).set(floatArray);
    const src = audioContext.createBufferSource();
    src.buffer = audioBuf;
    src.connect(audioContext.destination);

    const now = audioContext.currentTime;
    nextStartTime = Math.max(now, nextStartTime);
    src.start(nextStartTime);
    nextStartTime += audioBuf.duration;
    scheduledSources.push(src);
    src.onended = () => {
      const idx = scheduledSources.indexOf(src);
      if (idx > -1) scheduledSources.splice(idx, 1);
    };
  }

  // Active Conversation Identification
  function detectActiveConv() {
    // 1. Direct active conversation view (THE source of truth rendered on screen)
    const view = document.querySelector('[data-testid="conversation-view"]');
    const viewCid = view?.getAttribute('data-cascade-id');

    // 2. Explicit /c/<uuid> in URL pathname or hash
    const urlMatch = window.location.pathname.match(/\/c\/([0-9a-f-]{36})/i) ||
                     window.location.hash.match(/\/c\/([0-9a-f-]{36})/i);
    const urlCid = urlMatch?.[1];

    const cid = viewCid || urlCid;

    let title = "";
    if (cid) {
      const row = document.querySelector(`[data-cascade-id="${cid}"]`);
      if (row) {
        title = row.querySelector('span')?.innerText?.trim() ||
                row.querySelector('a')?.getAttribute('aria-label') || "";
      }
    }

    if (!title && view) {
      const headerEl = view.parentElement?.querySelector('nav, header, [class*="breadcrumb"]') ||
                       document.querySelector('header');
      if (headerEl) {
        const parts = headerEl.innerText.split(/[\/\n]/).map(s => s.trim()).filter(Boolean);
        if (parts.length > 0) title = parts[parts.length - 1];
      }
    }

    if (!title && document.title) {
      title = document.title.replace(/\s*-\s*Antigravity\s*$/i, "").trim();
    }

    if (cid) {
      return { id: cid, title: title || "Active Chat" };
    }

    // 3. Fallback: sidebar selected row
    const selectedRow = document.querySelector('[data-testid="conversation-row-sidebar"][data-selected="true"], .bg-sidebar-secondary[data-cascade-id]');
    if (selectedRow) {
      const sid = selectedRow.getAttribute('data-cascade-id') || selectedRow.querySelector('a')?.getAttribute('href')?.match(/\/c\/([0-9a-f-]{36})/i)?.[1];
      const sTitle = selectedRow.querySelector('span')?.innerText?.trim() || "";
      if (sid) return { id: sid, title: sTitle || "Active Chat" };
    }

    return null;
  }

  function syncActiveConversation(force = false) {
    const conv = detectActiveConv();
    if (conv && conv.id && (conv.id !== currentConvId || force)) {
      currentConvId = conv.id;
      const title = conv.title || "Chat";
      appendLog("Switched to conversation: " + title.slice(0, 24), "#10b981");
      statusBadge.textContent = "Chat: " + title.slice(0, 14);
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "set_active_conversation",
          conversation_id: conv.id,
          title: title,
        }));
      }
    }
  }

  // Find Antigravity Chat Input (Lexical Editor, textarea, or contenteditable)
  function findChatInputElement() {
    if (document.activeElement && (document.activeElement.isContentEditable || document.activeElement.tagName === "TEXTAREA" || document.activeElement.tagName === "INPUT")) {
      if (!document.getElementById("ag-voice-butler-root")?.contains(document.activeElement)) {
        return document.activeElement;
      }
    }

    const selectors = [
      '[data-lexical-editor="true"]',
      'div[contenteditable="true"][aria-label="Message input"]',
      'div[contenteditable="true"]',
      '[contenteditable="true"]',
      '[aria-label="Message input"]',
      'textarea[aria-label="Message input"]',
      'textarea',
      '[role="textbox"]',
      '[role="combobox"]',
      'div[contenteditable]'
    ];
    for (const sel of selectors) {
      try {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (!document.getElementById("ag-voice-butler-root")?.contains(el)) {
            return el;
          }
        }
      } catch (_) {}
    }

    const all = document.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el.isContentEditable && !document.getElementById("ag-voice-butler-root")?.contains(el)) {
        return el;
      }
    }
    return null;
  }

  // Direct In-Tab Typing
  function writeToCurrentChat(prompt, submit) {
    appendLog("[Typing to chat] " + prompt.slice(0, 30) + "...", "#10b981");
    const el = findChatInputElement();
    if (!el) {
      appendLog("[Input element not found in DOM; signaling server fallback...]", "#f59e0b");
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: "client_write_failed",
          error: "Input element not found in DOM",
          prompt: prompt,
          submit: submit,
        }));
      }
      return;
    }

    el.focus();
    try { el.click(); } catch (_) {}

    if (el.tagName.toLowerCase() === "textarea" || el.tagName.toLowerCase() === "input") {
      el.value = prompt;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      let ok = false;
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand("delete", false, null);
        ok = document.execCommand("insertText", false, prompt);
      } catch (_) {}

      if (!ok || !el.textContent || el.textContent.trim() === "") {
        el.innerHTML = `<p dir="auto"><span data-lexical-text="true">${prompt}</span></p>`;
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: "client_write_success",
        prompt: prompt,
        submit: submit,
      }));
    }

    if (submit) {
      setTimeout(() => {
        let sent = false;
        const sendSelectors = [
          'button[aria-label="Send message"]',
          'button[aria-label="Send"]',
          'button.bg-primary',
          'button[type="submit"]',
        ];
        for (const s of sendSelectors) {
          const btn = document.querySelector(s);
          if (btn && !btn.disabled && !document.getElementById("ag-voice-butler-root")?.contains(btn)) {
            btn.click();
            sent = true;
            appendLog("[Prompt submitted via button!]", "#10b981");
            break;
          }
        }
        if (!sent) {
          el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
          appendLog("[Dispatched Enter key submission]", "#10b981");
        }
      }, 150);
    }
  }

  // WebSocket Connection
  function connectWebSocket() {
    const conv = detectActiveConv();
    const cid = conv ? conv.id : "";
    const url = DEFAULT_SERVER_URL + (cid ? "?conversation_id=" + encodeURIComponent(cid) : "");
    appendLog("Connecting to " + url + "...", "#fbbf24");

    try {
      ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        isConnected = true;
        statusBadge.textContent = "Butler Live Ready";
        appendLog("Connected to Gemini Live!", "#10b981");
        syncActiveConversation();
      };

      ws.onmessage = async (e) => {
        if (typeof e.data === "string") {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === "gemini") {
              appendLog("Puck: " + msg.text, "#c084fc");
            } else if (msg.type === "user") {
              appendLog("You: " + msg.text, "#38bdf8");
            } else if (msg.type === "tool_start") {
              appendLog("[Tool: " + msg.name + "]", "#f59e0b");
            } else if (msg.type === "client_write_to_chat") {
              writeToCurrentChat(msg.prompt, msg.submit);
            } else if (msg.type === "interrupted") {
              appendLog("[Puck interrupted]", "#94a3b8");
              stopAudioPlayback();
            } else if (msg.type === "turn_complete") {
              statusBadge.textContent = isRecording ? "Listening..." : "Butler Ready";
            } else if (msg.type === "error") {
              appendLog("Error: " + msg.error, "#ef4444");
            }
          } catch (_) {}
        } else {
          let raw = e.data;
          if (raw instanceof Blob) {
            raw = await raw.arrayBuffer();
          }
          play24kPCM(raw);
        }
      };

      ws.onerror = (err) => {
        appendLog("WebSocket error occurred", "#ef4444");
      };

      ws.onclose = () => {
        isConnected = false;
        statusBadge.textContent = "Offline (Tap 🎙️)";
        appendLog("WebSocket disconnected", "#f43f5e");
        stopMicrophone();
      };
    } catch (err) {
      appendLog("Connection init failed: " + err.message, "#ef4444");
    }
  }

  // Microphone Streaming
  async function startMicrophone() {
    if (!ws || ws.readyState !== 1) {
      connectWebSocket();
    }
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const source = audioContext.createMediaStreamSource(micStream);
      scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      scriptProcessor.onaudioprocess = (e) => {
        if (!isRecording || !ws || ws.readyState !== 1) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const downsampled = downsample(inputData, audioContext.sampleRate, 16000);
        const pcm16 = toInt16PCM(downsampled);
        ws.send(pcm16);
      };

      source.connect(scriptProcessor);
      const muteGain = audioContext.createGain();
      muteGain.gain.value = 0;
      scriptProcessor.connect(muteGain);
      muteGain.connect(audioContext.destination);

      isRecording = true;
      micBtn.textContent = "🔴";
      micBtn.style.background = "#dc2626";
      micBtn.style.boxShadow = "0 0 20px rgba(220, 38, 38, 0.7)";
      statusBadge.textContent = "Listening...";
      appendLog("Mic live: streaming 16kHz PCM", "#ef4444");
    } catch (err) {
      appendLog("Mic access error: " + err.message, "#ef4444");
      stopMicrophone();
    }
  }

  function stopMicrophone() {
    isRecording = false;
    micBtn.textContent = "🎙️";
    micBtn.style.background = "#4f46e5";
    micBtn.style.boxShadow = "0 4px 16px rgba(79, 70, 229, 0.6)";
    statusBadge.textContent = isConnected ? "Butler Ready" : "Offline";
    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
      micStream = null;
    }
    if (scriptProcessor) {
      try { scriptProcessor.disconnect(); } catch (_) {}
      scriptProcessor = null;
    }
  }

  // Toggle Mic on button click
  micBtn.onclick = () => {
    if (isRecording) stopMicrophone();
    else startMicrophone();
  };

  // Sync active conversation every 1.5 seconds
  syncTimer = setInterval(syncActiveConversation, 1500);

  // Listen for clicks on conversation items in the sidebar for instant sync
  document.addEventListener("click", (e) => {
    if (e.target.closest('[data-testid="conversation-row-sidebar"], [data-cascade-id], a[href*="/c/"]')) {
      setTimeout(() => syncActiveConversation(true), 150);
      setTimeout(() => syncActiveConversation(true), 600);
      setTimeout(() => syncActiveConversation(true), 1200);
    }
  });

  // Extension runtime message listener for action click toggle and background tab sync
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "TOGGLE_ORB") {
        root.style.display = root.style.display === "none" ? "flex" : "none";
      } else if (msg.type === "SYNC_CONVERSATION") {
        setTimeout(() => syncActiveConversation(true), 100);
      }
    });
  }

  // Auto connect on startup
  connectWebSocket();
})();
