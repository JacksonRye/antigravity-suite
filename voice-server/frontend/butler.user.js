// ==UserScript==
// @name         Antigravity Voice Butler (Gemini Live)
// @namespace    https://butler.retake.cloud/
// @version      3.4.0
// @description  In-Tab Gemini Live Voice Butler with Multimodal Screen Vision and Brain Context Sync
// @match        *://*/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(() => {
  // Clean up any old Butler instance before mounting the latest version
  if (window.__antigravityButlerCleanup) {
    try { window.__antigravityButlerCleanup(); } catch (_) {}
  }

  const SERVER_WS_URL = "wss://butler.retake.cloud/ws";
  let ws = null;
  let audioCtx = null;
  let micStream = null;
  let spNode = null;
  let isRecording = false;
  let isConnected = false;
  let currentConvId = "";
  let scheduledSources = [];
  let isCapturingSnapshot = false;
  let snapshotInterval = null;

  // Dynamically load html2canvas for high-fidelity tab snapshot capture
  if (!window.html2canvas) {
    const h2cScript = document.createElement("script");
    h2cScript.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    h2cScript.async = true;
    document.head.appendChild(h2cScript);
  }
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
    let title = "";
    let cid = "";

    // 1. Direct active conversation view (rendered on screen)
    const view = document.querySelector('[data-testid="conversation-view"]');
    const viewCid = view?.getAttribute('data-cascade-id');

    // 2. Explicit /c/<uuid> in URL pathname or hash
    const urlMatch = window.location.pathname.match(/\/c\/([0-9a-f-]{36})/i) ||
                     window.location.hash.match(/\/c\/([0-9a-f-]{36})/i);
    const urlCid = urlMatch?.[1];
    cid = viewCid || urlCid || "";

    // 3. Inspect top breadcrumbs (e.g. "Alter Ego / Alter Ego" or "Project / Chat Name")
    const breadcrumbEls = document.querySelectorAll('header span, nav span, [class*="breadcrumb"], div[class*="items-center"] span');
    for (const b of breadcrumbEls) {
      const txt = (b.innerText || "").trim();
      if (txt.includes(' / ') || (txt.includes('/') && txt.length > 3)) {
        const parts = txt.split('/').map(s => s.trim()).filter(Boolean);
        if (parts.length > 0) {
          title = parts[parts.length - 1];
          break;
        }
      }
    }

    // 4. Inspect active sidebar item
    if (!title) {
      const activeSidebar = document.querySelector('[data-testid="conversation-row-sidebar"][data-selected="true"], [class*="bg-sidebar-secondary"], [class*="bg-accent"], [aria-selected="true"]');
      if (activeSidebar) {
        const sParts = (activeSidebar.innerText || "").trim().split('\n').filter(Boolean);
        if (sParts.length > 0 && sParts[0] !== "New Conversation") {
          title = sParts[0];
          cid = cid || activeSidebar.getAttribute('data-cascade-id') || activeSidebar.querySelector('a')?.getAttribute('href')?.match(/\/c\/([0-9a-f-]{36})/i)?.[1] || "";
        }
      }
    }

    // 5. Document title fallback
    if (!title && document.title) {
      const docT = document.title.replace(/\s*-\s*Antigravity\s*$/i, "").trim();
      if (docT && docT.toLowerCase() !== "antigravity") {
        title = docT;
      }
    }

    if (cid || title) {
      return { id: cid, title: title || "Active Chat" };
    }

    return null;
  }

  // Silent Context Sync across conversation switches
  let currentConvTitle = "";
  function syncActiveChat(force = false) {
    const conv = detectActiveConv();
    if (conv && (conv.id || conv.title)) {
      const isNewId = conv.id && conv.id !== currentConvId;
      const isNewTitle = conv.title && conv.title !== currentConvTitle && conv.title !== "Active Chat";
      if (isNewId || isNewTitle || force) {
        if (conv.id) currentConvId = conv.id;
        if (conv.title && conv.title !== "Active Chat") currentConvTitle = conv.title;
        log("Active: " + currentConvTitle.slice(0, 24), "#10b981");
        statusBadge.textContent = "Chat: " + currentConvTitle.slice(0, 16);
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: "switch_active_conversation",
            conversation_id: conv.id || "",
            title: currentConvTitle,
          }));
        }
      }
    }
  }

  // Find Antigravity Chat Input (Lexical Editor, textarea, or contenteditable)
  function findChatInputElement() {
    // 1. Direct active or focused editable element
    if (document.activeElement && (document.activeElement.isContentEditable || document.activeElement.tagName === "TEXTAREA" || document.activeElement.tagName === "INPUT")) {
      if (!document.getElementById("ag-butler-in-tab-root")?.contains(document.activeElement)) {
        return document.activeElement;
      }
    }

    // 2. High priority selectors
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
          if (!document.getElementById("ag-butler-in-tab-root")?.contains(el)) {
            return el;
          }
        }
      } catch (_) {}
    }

    // 3. Search near "Ask anything" placeholder
    const all = document.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const node = all[i];
      if (document.getElementById("ag-butler-in-tab-root")?.contains(node)) continue;
      const text = (node.textContent || "").trim();
      const placeholder = (node.getAttribute('placeholder') || node.getAttribute('data-placeholder') || "").trim();
      if (text.includes("Ask anything") || placeholder.includes("Ask anything")) {
        const parent = node.closest('div[class*="rounded"], form, [role="region"]') || node.parentElement;
        if (parent) {
          const editable = parent.querySelector('[contenteditable], textarea, input');
          if (editable) return editable;
        }
      }
    }

    // 4. Any element with isContentEditable in document
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
      log("[Input element not found in DOM]", "#ef4444");
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
        ok = document.execCommand("insertText", false, prompt);
      } catch (_) {}

      if (!ok || !el.textContent || el.textContent.trim() === "") {
        el.innerHTML = `<p dir="auto"><span data-lexical-text="true">${prompt}</span></p>`;
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
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
    log("[Drafted into chat input]", "#10b981");

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
      }, 250);
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
            if (m.type === "active_conversation_updated") {
              currentConvId = m.conversation_id;
              currentConvTitle = m.title || "Active Chat";
              statusBadge.textContent = "Chat: " + currentConvTitle.slice(0, 16);
              log("[Synced to " + currentConvTitle + "]", "#10b981");
            } else if (m.type === "gemini") {
              log("Puck: " + m.text, "#c084fc");
            } else if (m.type === "user") {
              log("You: " + m.text, "#38bdf8");
            } else if (m.type === "tool_start") {
              log("[Tool: " + m.name + "]", "#f59e0b");
            } else if (m.type === "prompt_submitted_to_ide") {
              log("[VPS Bridge: Prompt sent & submitted!]", "#10b981");
            } else if (m.type === "client_write_to_chat") {
              writeToCurrentChat(m.prompt, m.submit);
            } else if (m.type === "client_navigate_to_conv") {
              log("[Switching view to " + (m.title || m.conversation_id) + "...]", "#38bdf8");
              const row = document.querySelector(`[data-cascade-id="${m.conversation_id}"], a[href*="${m.conversation_id}"]`);
              if (row) {
                row.click();
                log("[Navigated to " + (m.title || m.conversation_id) + "]", "#10b981");
              } else {
                try {
                  history.pushState(null, "", `/c/${m.conversation_id}`);
                  window.dispatchEvent(new PopStateEvent("popstate"));
                  syncActiveChat(true);
                } catch (_) {
                  window.location.href = `/c/${m.conversation_id}`;
                }
              }
            } else if (m.type === "interrupted") {
              log("[Interrupted]", "#94a3b8");
              stopPlayback();
            } else if (m.type === "turn_complete") {
              statusBadge.textContent = isRecording ? "Listening..." : (currentConvTitle ? "Chat: " + currentConvTitle.slice(0, 14) : "Butler Ready");
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

  // Screen Vision Snapshot Engine
  async function captureAndSendScreenSnapshot() {
    if (isCapturingSnapshot || !ws || ws.readyState !== 1) return;
    isCapturingSnapshot = true;
    try {
      const root = document.getElementById("ag-butler-in-tab-root");
      if (window.html2canvas) {
        if (root) root.style.opacity = "0.05";
        const canvas = await window.html2canvas(document.body, {
          scale: 0.5,
          useCORS: true,
          logging: false,
          ignoreElements: (el) => el.id === "ag-butler-in-tab-root",
        });
        if (root) root.style.opacity = "1";
        const dataUrl = canvas.toDataURL("image/jpeg", 0.65);
        const b64 = dataUrl.split(",")[1];
        if (b64 && ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "image", data: b64 }));
          log("[Screen Snapshot sent to Puck]", "#38bdf8");
        }
      } else {
        const w = window.innerWidth || 1024;
        const h = window.innerHeight || 768;
        const breadcrumb = document.querySelector('header span, nav span, [class*="breadcrumb"]')?.innerText || document.title;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w / 2);
        canvas.height = Math.round(h / 2);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#1e1e1e";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 20px sans-serif";
        ctx.fillText(document.title || "Antigravity", 20, 40);
        ctx.font = "16px sans-serif";
        ctx.fillStyle = "#38bdf8";
        ctx.fillText("Active: " + (currentConvTitle || breadcrumb), 20, 80);
        const b64 = canvas.toDataURL("image/jpeg", 0.65).split(",")[1];
        if (b64 && ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "image", data: b64 }));
          log("[Screen State sent to Puck]", "#38bdf8");
        }
      }
    } catch (err) {
      console.warn("Screen snapshot error:", err);
    } finally {
      const root = document.getElementById("ag-butler-in-tab-root");
      if (root) root.style.opacity = "1";
      isCapturingSnapshot = false;
    }
  }

  // Microphone Streaming
  async function startMic() {
    unlockAudio();
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

      // Send on-demand snapshot of tab when speaking starts & pulse every 5s
      setTimeout(captureAndSendScreenSnapshot, 200);
      if (snapshotInterval) clearInterval(snapshotInterval);
      snapshotInterval = setInterval(captureAndSendScreenSnapshot, 5000);
    } catch (err) {
      log("Mic error: " + err.message, "#ef4444");
      stopMic();
    }
  }

  function stopMic() {
    isRecording = false;
    if (snapshotInterval) {
      clearInterval(snapshotInterval);
      snapshotInterval = null;
    }
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
    const row = e.target.closest('[data-testid="conversation-row-sidebar"], a[href*="/c/"], [data-cascade-id], [class*="rounded"]');
    if (row && (row.closest('nav') || row.closest('aside') || row.closest('[class*="sidebar"]'))) {
      const parts = (row.innerText || "").trim().split('\n').filter(Boolean);
      const title = parts[0];
      const cid = row.getAttribute('data-cascade-id') || row.querySelector('a')?.getAttribute('href')?.match(/\/c\/([0-9a-f-]{36})/i)?.[1];
      if (title && title.length > 1 && title !== "New Conversation") {
        log("[Selected " + title + "]", "#38bdf8");
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: "switch_active_conversation",
            conversation_id: cid || "",
            title: title,
          }));
        }
      }
    }
    setTimeout(() => syncActiveChat(true), 150);
    setTimeout(() => syncActiveChat(true), 600);
  });
  setInterval(syncActiveChat, 1000);

  // Cleanup hook for future updates
  window.__antigravityButlerCleanup = () => {
    try { if (ws) ws.close(); } catch (_) {}
    try { stopMic(); } catch (_) {}
    try { if (audioCtx) audioCtx.close(); } catch (_) {}
    const r = document.getElementById("ag-butler-in-tab-root");
    if (r) r.remove();
  };

  // Auto connect
  connectWs();
})();
