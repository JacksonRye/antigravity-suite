// ==UserScript==
// @name         Antigravity Voice Butler (Gemini Live)
// @namespace    https://butler.retake.cloud/
// @version      2.3.0
// @description  In-Tab Gemini Live Voice Butler with 100% active chat context and direct typing
// @match        *://*/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(() => {
  // Prevent duplicate execution
  if (window.__antigravityButlerUserscriptLoaded) return;
  window.__antigravityButlerUserscriptLoaded = true;

  const SERVER_WS_URL = "wss://butler.retake.cloud/ws";
  let ws = null;
  let audioCtx = null;
  let micStream = null;
  let spNode = null;
  let isRecording = false;
  let isConnected = false;
  let currentConvId = "";
  let scheduledSources = [];
  let nextStartTime = 0;
  let isDragging = false;

  // On-screen logger
  function log(msg, color = "#94a3b8") {
    console.log("[Butler]", msg);
    const box = document.getElementById("ag-butler-log");
    if (!box) return;
    const line = document.createElement("div");
    line.style.color = color;
    line.style.fontSize = "11px";
    line.style.lineHeight = "1.3";
    line.textContent = "[" + new Date().toLocaleTimeString().split(" ")[0] + "] " + msg;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  // UI Setup: Floating Orb + Collapsible Console
  const root = document.createElement("div");
  root.id = "ag-butler-in-tab-root";
  root.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    user-select: none;
    touch-action: none;
  `;

  // Console Box
  const consoleCard = document.createElement("div");
  consoleCard.id = "ag-butler-card";
  consoleCard.style.cssText = `
    width: 320px;
    height: 190px;
    background: rgba(15, 23, 42, 0.94);
    border: 1px solid #334155;
    border-radius: 14px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    transition: all 0.2s ease;
  `;

  const consoleHeader = document.createElement("div");
  consoleHeader.style.cssText = `
    padding: 7px 12px;
    background: rgba(30, 41, 59, 0.9);
    border-bottom: 1px solid #334155;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    font-weight: 600;
    color: #94a3b8;
  `;
  consoleHeader.innerHTML = `
    <span style="display:flex;align-items:center;gap:6px;">
      <span id="ag-butler-dot" style="width:7px;height:7px;border-radius:50%;background:#f59e0b;display:inline-block;"></span>
      <span>Voice Butler (Puck)</span>
    </span>
    <div>
      <span id="ag-clear-btn" style="cursor:pointer;margin-right:10px;color:#cbd5e1;">Clear</span>
      <span id="ag-toggle-btn" style="cursor:pointer;color:#cbd5e1;">▼</span>
    </div>
  `;

  const logBox = document.createElement("div");
  logBox.id = "ag-butler-log";
  logBox.style.cssText = `
    flex: 1;
    padding: 8px 12px;
    overflow-y: auto;
    font-family: monospace;
    display: flex;
    flex-direction: column;
    gap: 3px;
  `;

  consoleCard.appendChild(consoleHeader);
  consoleCard.appendChild(logBox);

  // Bottom Control Bar
  const bar = document.createElement("div");
  bar.style.cssText = "display: flex; align-items: center; gap: 8px;";

  const statusBadge = document.createElement("div");
  statusBadge.id = "ag-butler-badge";
  statusBadge.style.cssText = `
    background: rgba(15, 23, 42, 0.9);
    color: #f8fafc;
    padding: 6px 14px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 500;
    border: 1px solid #334155;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `;
  statusBadge.textContent = "Butler Connecting...";

  // Orb Button & Aura
  const orbWrap = document.createElement("div");
  orbWrap.style.cssText = `
    position: relative;
    width: 60px;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  const orbAura = document.createElement("div");
  orbAura.id = "ag-butler-aura";
  orbAura.style.cssText = `
    position: absolute;
    top: -8px; left: -8px; right: -8px; bottom: -8px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(99, 102, 241, 0.5) 0%, rgba(56, 189, 248, 0.3) 60%, transparent 80%);
    filter: blur(10px);
    transform: scale(1);
    transition: transform 0.12s ease-out;
    pointer-events: none;
  `;

  const orbBtn = document.createElement("button");
  orbBtn.id = "ag-butler-orb";
  orbBtn.style.cssText = `
    position: relative;
    width: 54px;
    height: 54px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #38bdf8 0%, #6366f1 60%, #4338ca 100%);
    border: 2px solid #ffffff;
    box-shadow: 0 4px 16px rgba(99, 102, 241, 0.6);
    font-size: 24px;
    cursor: pointer;
    outline: none;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s ease, background 0.2s ease;
  `;
  orbBtn.textContent = "🎙️";

  orbWrap.appendChild(orbAura);
  orbWrap.appendChild(orbBtn);
  bar.appendChild(statusBadge);
  bar.appendChild(orbWrap);
  root.appendChild(consoleCard);
  root.appendChild(bar);

  // Safe Mount to DOM
  const mount = () => {
    if (document.body) document.body.appendChild(root);
    else if (document.documentElement) document.documentElement.appendChild(root);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();

  // Console Collapse
  let isMinimized = false;
  document.getElementById("ag-toggle-btn").onclick = () => {
    isMinimized = !isMinimized;
    logBox.style.display = isMinimized ? "none" : "flex";
    consoleCard.style.height = isMinimized ? "28px" : "190px";
    document.getElementById("ag-toggle-btn").textContent = isMinimized ? "▲" : "▼";
  };
  document.getElementById("ag-clear-btn").onclick = () => {
    logBox.textContent = "";
  };

  // Touch Dragging for iPad
  let startX = 0, startY = 0, initialRight = 24, initialBottom = 24;
  orbWrap.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      isDragging = false;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      const rect = root.getBoundingClientRect();
      initialRight = window.innerWidth - rect.right;
      initialBottom = window.innerHeight - rect.bottom;
    }
  }, { passive: true });

  orbWrap.addEventListener("touchmove", (e) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.hypot(dx, dy) > 8) {
        isDragging = true;
        const newRight = Math.max(10, Math.min(window.innerWidth - 70, initialRight - dx));
        const newBottom = Math.max(10, Math.min(window.innerHeight - 70, initialBottom - dy));
        root.style.right = `${newRight}px`;
        root.style.bottom = `${newBottom}px`;
      }
    }
  }, { passive: true });

  // WebAudio Helpers
  function downsample(b, sR, oR) {
    if (sR === oR) return b;
    const r = sR / oR, nL = Math.round(b.length / r), res = new Float32Array(nL);
    let oRes = 0, oBuf = 0;
    while (oRes < res.length) {
      const nOB = Math.round((oRes + 1) * r);
      let acc = 0, cnt = 0;
      for (let i = oBuf; i < nOB && i < b.length; i++) { acc += b[i]; cnt++; }
      res[oRes] = cnt ? acc / cnt : 0; oRes++; oBuf = nOB;
    }
    return res;
  }

  function toInt16(f32) {
    const buf = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      buf[i] = Math.min(1, Math.max(-1, f32[i])) * 0x7fff;
    }
    return buf.buffer;
  }

  function stopPlayback() {
    for (let i = 0; i < scheduledSources.length; i++) {
      try { scheduledSources[i].stop(); } catch (_) {}
    }
    scheduledSources = [];
    if (audioCtx) nextStartTime = audioCtx.currentTime;
  }

  function play24kPcm(buf) {
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") audioCtx.resume();
    const pcm = new Int16Array(buf);
    const flt = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) flt[i] = pcm[i] / 32768.0;

    const ab = audioCtx.createBuffer(1, flt.length, 24000);
    ab.getChannelData(0).set(flt);
    const src = audioCtx.createBufferSource();
    src.buffer = ab;
    src.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    nextStartTime = Math.max(now, nextStartTime);
    src.start(nextStartTime);
    nextStartTime += ab.duration;
    scheduledSources.push(src);

    orbAura.style.transform = "scale(1.2)";
    setTimeout(() => { orbAura.style.transform = "scale(1)"; }, 120);

    src.onended = () => {
      const idx = scheduledSources.indexOf(src);
      if (idx > -1) scheduledSources.splice(idx, 1);
    };
  }

  // Active Conversation Identification
  function detectActiveConv() {
    // 1. Selected conversation row in sidebar (most accurate in Antigravity)
    const selectedRow = document.querySelector('[data-testid="conversation-row-sidebar"][data-selected="true"]');
    if (selectedRow) {
      const cid = selectedRow.getAttribute('data-cascade-id') || selectedRow.querySelector('a')?.getAttribute('href')?.match(/\/c\/([0-9a-f-]{36})/i)?.[1];
      const title = selectedRow.querySelector('span')?.innerText?.trim() || selectedRow.querySelector('a')?.getAttribute('aria-label') || "";
      if (cid) return { id: cid, title };
    }
    // 2. Explicit /c/<uuid> in URL pathname
    const m = window.location.pathname.match(/\/c\/([0-9a-f-]{36})/i);
    if (m) {
      const title = document.title ? document.title.replace(/\s*-\s*Antigravity\s*$/i, "").trim() : "";
      return { id: m[1], title };
    }
    // 3. Fallback: highlighted active link in sidebar
    const activeA = document.querySelector('.bg-sidebar-secondary a[href*="/c/"]');
    if (activeA) {
      const linkMatch = activeA.getAttribute('href')?.match(/\/c\/([0-9a-f-]{36})/i);
      if (linkMatch) return { id: linkMatch[1], title: activeA.getAttribute('aria-label') || "" };
    }
    return null;
  }

  // Silent Context Sync across conversation switches
  function syncActiveChat(force = false) {
    const conv = detectActiveConv();
    if (conv && conv.id && (conv.id !== currentConvId || force)) {
      currentConvId = conv.id;
      const title = conv.title || "Chat";
      log("Switched to conversation: " + title.slice(0, 24), "#10b981");
      statusBadge.textContent = title.slice(0, 16);
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
    const selectors = [
      '[data-lexical-editor="true"]',
      '[contenteditable="true"][aria-label="Message input"]',
      '[aria-label="Message input"]',
      '[role="combobox"][contenteditable]',
      'div[contenteditable="true"]',
      'div[contenteditable]',
      'textarea[aria-label="Message input"]',
      'textarea'
    ];
    for (const sel of selectors) {
      const found = document.querySelector(sel);
      if (found && !document.getElementById("ag-butler-in-tab-root")?.contains(found)) {
        return found;
      }
    }
    const all = document.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el.isContentEditable && !document.getElementById("ag-butler-in-tab-root")?.contains(el)) {
        return el;
      }
    }
    return null;
  }

  // Direct In-DOM Typing Execution
  function writeToCurrentChat(prompt, submit = false) {
    log("[Typing to chat] " + prompt.slice(0, 35) + "...", "#10b981");
    const el = findChatInputElement();

    if (!el) {
      log("[Input element not found in DOM; signaling VPS fallback...]", "#f59e0b");
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
    if (el.tagName.toLowerCase() === "textarea") {
      el.value = prompt;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand("delete", false, null);
        document.execCommand("insertText", false, prompt);
      } catch (_) {}

      if (!el.textContent || el.textContent.trim() === "") {
        el.innerHTML = `<p dir="auto"><span data-lexical-text="true">${prompt}</span></p>`;
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // Signal in-tab success to server
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: "client_write_success",
        prompt: prompt,
        submit: submit,
      }));
    }

    if (submit) {
      setTimeout(() => {
        let btn = document.querySelector('button[aria-label="Send message"]') ||
                  document.querySelector('button[aria-label="Send"]') ||
                  document.querySelector('button[type="submit"]');

        if (!btn) {
          let p = el.parentElement;
          for (let i = 0; i < 5; i++) {
            if (!p) break;
            const btns = p.querySelectorAll('button');
            for (const b of btns) {
              if (b.getAttribute('aria-label')?.toLowerCase().includes('send') || b.className.includes('bg-primary')) {
                btn = b;
                break;
              }
            }
            if (btn) break;
            p = p.parentElement;
          }
        }

        if (btn && !btn.disabled) {
          btn.click();
          log("[Prompt submitted to Antigravity!]", "#10b981");
        } else {
          el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
          log("[Dispatched Enter key submission]", "#10b981");
        }
      }, 150);
    }
  }

  // WebSocket Connection
  function connectWs() {
    const conv = detectActiveConv();
    const cid = conv ? conv.id : "";
    const url = SERVER_WS_URL + (cid ? "?conversation_id=" + encodeURIComponent(cid) : "");
    log("Connecting to Butler Live...", "#fbbf24");

    try {
      ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        isConnected = true;
        document.getElementById("ag-butler-dot").style.background = "#10b981";
        statusBadge.textContent = "Butler Ready";
        log("Connected to Gemini Live!", "#10b981");
        syncActiveChat(true);
      };

      ws.onmessage = async (e) => {
        if (typeof e.data === "string") {
          try {
            const m = JSON.parse(e.data);
            if (m.type === "gemini") {
              log("Puck: " + m.text, "#c084fc");
            } else if (m.type === "user") {
              log("You: " + m.text, "#38bdf8");
            } else if (m.type === "tool_start") {
              log("[Tool: " + m.name + "]", "#f59e0b");
            } else if (m.type === "client_write_to_chat") {
              writeToCurrentChat(m.prompt, m.submit);
            } else if (m.type === "interrupted") {
              log("[Interrupted]", "#94a3b8");
              stopPlayback();
            } else if (m.type === "turn_complete") {
              statusBadge.textContent = isRecording ? "Listening..." : "Butler Ready";
            } else if (m.type === "error") {
              log("Error: " + m.error, "#ef4444");
            }
          } catch (_) {}
        } else {
          let raw = e.data;
          if (raw instanceof Blob) raw = await raw.arrayBuffer();
          play24kPcm(raw);
        }
      };

      ws.onerror = () => {
        document.getElementById("ag-butler-dot").style.background = "#ef4444";
        log("WebSocket error", "#ef4444");
      };

      ws.onclose = () => {
        isConnected = false;
        document.getElementById("ag-butler-dot").style.background = "#ef4444";
        statusBadge.textContent = "Offline (Tap 🎙️)";
        log("WebSocket closed", "#f43f5e");
        stopMic();
      };
    } catch (err) {
      log("Connection failed: " + err.message, "#ef4444");
    }
  }

  // Microphone Streaming
  async function startMic() {
    if (!ws || ws.readyState !== 1) connectWs();
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    }
    if (audioCtx.state === "suspended") await audioCtx.resume();

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const src = audioCtx.createMediaStreamSource(micStream);
      spNode = audioCtx.createScriptProcessor(4096, 1, 1);
      spNode.onaudioprocess = (e) => {
        if (!isRecording || !ws || ws.readyState !== 1) return;
        const inData = e.inputBuffer.getChannelData(0);
        const ds = downsample(inData, audioCtx.sampleRate, 16000);
        const pcm16 = toInt16(ds);
        ws.send(pcm16);

        let sum = 0;
        for (let i = 0; i < inData.length; i += 16) sum += inData[i] * inData[i];
        const rms = Math.sqrt(sum / (inData.length / 16));
        const scale = 1 + Math.min(rms * 12, 0.6);
        orbAura.style.transform = `scale(${scale})`;
      };

      src.connect(spNode);
      const mute = audioCtx.createGain();
      mute.gain.value = 0;
      spNode.connect(mute);
      mute.connect(audioCtx.destination);

      isRecording = true;
      orbBtn.textContent = "🔴";
      orbBtn.style.background = "#dc2626";
      orbBtn.style.boxShadow = "0 0 20px rgba(220, 38, 38, 0.7)";
      statusBadge.textContent = "Listening...";
      log("Mic streaming 16kHz PCM", "#ef4444");
    } catch (err) {
      log("Mic error: " + err.message, "#ef4444");
      stopMic();
    }
  }

  function stopMic() {
    isRecording = false;
    orbBtn.textContent = "🎙️";
    orbBtn.style.background = "radial-gradient(circle at 35% 30%, #38bdf8 0%, #6366f1 60%, #4338ca 100%)";
    orbBtn.style.boxShadow = "0 4px 16px rgba(99, 102, 241, 0.6)";
    statusBadge.textContent = isConnected ? "Butler Ready" : "Offline";
    orbAura.style.transform = "scale(1)";
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    if (spNode) {
      try { spNode.disconnect(); } catch (_) {}
      spNode = null;
    }
  }

  orbBtn.onclick = () => {
    if (isDragging) return;
    if (isRecording) stopMic();
    else startMic();
  };

  // URL / Tab-switch observer (catches pushState, popstate, and DOM navigation)
  const origPushState = history.pushState;
  history.pushState = function () {
    origPushState.apply(this, arguments);
    syncActiveChat();
  };
  const origReplaceState = history.replaceState;
  history.replaceState = function () {
    origReplaceState.apply(this, arguments);
    syncActiveChat();
  };
  window.addEventListener("popstate", () => syncActiveChat());
  // Listen for clicks on conversation items in the sidebar for instant sync
  document.addEventListener("click", (e) => {
    if (e.target.closest('[data-testid="conversation-row-sidebar"], a[href*="/c/"]')) {
      setTimeout(() => syncActiveChat(true), 150);
      setTimeout(() => syncActiveChat(true), 600);
    }
  });
  setInterval(syncActiveChat, 1000);

  // Auto connect
  connectWs();
})();
