// ==UserScript==
// @name         The Butler (Gemini Live)
// @namespace    https://butler.retake.cloud/
// @version      2.0.9
// @description  In-Tab Gemini Live Voice Butler for Google Antigravity
// @match        https://antigravity.google.com/*
// @match        *://*.google.com/*
// @match        *://*.usercontent.goog/*
// @match        *://*/*
// @updateURL    https://butler.retake.cloud/butler.user.js
// @downloadURL  https://butler.retake.cloud/butler.user.js
// @allFrames    true
// @grant        none
// @run-at       document-end
// ==/UserScript==

// 0. Inject Butler Stylesheet
(() => {
  if (document.getElementById("the-butler-css")) return;
  const style = document.createElement("style");
  style.id = "the-butler-css";
  style.textContent = '/* The Butler - In-Tab Styles */\n\n#agy-voice-container {\n  position: fixed;\n  bottom: 22px;\n  right: 22px;\n  z-index: 2147483647;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\n  user-select: none;\n}\n\n#agy-voice-btn {\n  width: 44px;\n  height: 44px;\n  border-radius: 50%;\n  background: rgba(26, 27, 30, 0.9);\n  backdrop-filter: blur(16px);\n  -webkit-backdrop-filter: blur(16px);\n  border: 1px solid rgba(255, 255, 255, 0.16);\n  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.45);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  cursor: pointer;\n  user-select: none;\n  color: #94a3b8;\n  outline: none;\n  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);\n}\n\n#agy-voice-btn svg {\n  width: 20px;\n  height: 20px;\n}\n\n#agy-voice-btn:hover {\n  transform: scale(1.08);\n  color: #f8fafc;\n  border-color: rgba(255, 255, 255, 0.3);\n  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.55);\n}\n\n#agy-voice-btn.connecting {\n  color: #f59e0b;\n  border-color: rgba(245, 158, 11, 0.7);\n  box-shadow: 0 0 18px rgba(245, 158, 11, 0.5);\n  animation: agy-pulse 1.4s infinite ease-in-out;\n}\n\n#agy-voice-btn.listening {\n  color: #38bdf8;\n  background: rgba(15, 23, 42, 0.95);\n  border-color: rgba(56, 189, 248, 0.8);\n  box-shadow: 0 0 22px rgba(56, 189, 248, 0.6);\n}\n\n#agy-voice-btn.speaking {\n  color: #c084fc;\n  background: rgba(24, 16, 42, 0.95);\n  border-color: rgba(192, 132, 252, 0.8);\n  box-shadow: 0 0 26px rgba(192, 132, 252, 0.75);\n  animation: agy-speaking 0.9s infinite alternate ease-in-out;\n}\n\n#agy-voice-btn.error {\n  color: #ef4444;\n  border-color: rgba(239, 68, 68, 0.8);\n  box-shadow: 0 0 20px rgba(239, 68, 68, 0.6);\n  background: rgba(40, 10, 15, 0.95);\n}\n\n#agy-voice-console-btn {\n  width: 34px;\n  height: 34px;\n  border-radius: 50%;\n  background: rgba(26, 27, 30, 0.85);\n  backdrop-filter: blur(12px);\n  -webkit-backdrop-filter: blur(12px);\n  border: 1px solid rgba(255, 255, 255, 0.12);\n  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.35);\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  cursor: pointer;\n  user-select: none;\n  color: #71717a;\n  outline: none;\n  transition: all 0.2s ease;\n}\n\n#agy-voice-console-btn:hover {\n  color: #38bdf8;\n  border-color: rgba(56, 189, 248, 0.4);\n  transform: scale(1.08);\n}\n\n#agy-voice-badge {\n  display: none;\n  padding: 5px 12px;\n  font-size: 11px;\n  font-weight: 500;\n  color: #f1f5f9;\n  background: rgba(15, 23, 42, 0.95);\n  border: 1px solid rgba(255, 255, 255, 0.15);\n  border-radius: 12px;\n  backdrop-filter: blur(16px);\n  -webkit-backdrop-filter: blur(16px);\n  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);\n  white-space: nowrap;\n  pointer-events: auto;\n  cursor: pointer;\n}\n\n#agy-voice-container:hover #agy-voice-badge {\n  display: block;\n}\n\n/* 520x520 Live Debug Console Drawer */\n#agy-voice-console-drawer {\n  position: fixed;\n  bottom: 76px;\n  right: 22px;\n  width: 520px;\n  height: 520px;\n  max-height: calc(100vh - 100px);\n  max-width: calc(100vw - 44px);\n  border-radius: 14px;\n  background: rgba(13, 15, 22, 0.97);\n  backdrop-filter: blur(28px);\n  -webkit-backdrop-filter: blur(28px);\n  border: 1px solid rgba(255, 255, 255, 0.14);\n  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);\n  display: none;\n  flex-direction: column;\n  overflow: hidden;\n  z-index: 2147483647;\n  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\n  color: #e2e8f0;\n}\n\n.agy-console-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 10px 14px;\n  background: rgba(255, 255, 255, 0.03);\n  border-bottom: 1px solid rgba(255, 255, 255, 0.08);\n}\n\n.agy-console-title {\n  font-size: 12px;\n  font-weight: 600;\n  letter-spacing: 0.5px;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  color: #f8fafc;\n}\n\n.agy-console-status-pill {\n  font-size: 10px;\n  padding: 2px 7px;\n  border-radius: 8px;\n  background: rgba(255, 255, 255, 0.1);\n  font-weight: 500;\n}\n\n.agy-console-status-pill.connecting { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }\n.agy-console-status-pill.listening { background: rgba(56, 189, 248, 0.2); color: #38bdf8; }\n.agy-console-status-pill.speaking { background: rgba(192, 132, 252, 0.2); color: #c084fc; }\n.agy-console-status-pill.error { background: rgba(239, 68, 68, 0.2); color: #ef4444; }\n\n.agy-console-actions {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  padding: 8px 12px;\n  background: rgba(0, 0, 0, 0.2);\n  border-bottom: 1px solid rgba(255, 255, 255, 0.06);\n  flex-wrap: wrap;\n}\n\n.agy-btn-action {\n  font-size: 11px;\n  padding: 4px 9px;\n  border-radius: 6px;\n  border: 1px solid rgba(255, 255, 255, 0.14);\n  background: rgba(255, 255, 255, 0.06);\n  color: #cbd5e1;\n  cursor: pointer;\n  transition: all 0.15s;\n  user-select: none;\n}\n\n.agy-btn-action:hover {\n  background: rgba(255, 255, 255, 0.12);\n  color: #ffffff;\n}\n\n.agy-btn-action.highlight {\n  background: rgba(56, 189, 248, 0.2);\n  border-color: rgba(56, 189, 248, 0.4);\n  color: #38bdf8;\n}\n\n.agy-config-box {\n  padding: 8px 12px;\n  background: rgba(0, 0, 0, 0.3);\n  border-bottom: 1px solid rgba(255, 255, 255, 0.06);\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n\n.agy-config-input-row {\n  display: flex;\n  gap: 6px;\n}\n\n.agy-config-input {\n  flex: 1;\n  background: rgba(0, 0, 0, 0.4);\n  border: 1px solid rgba(255, 255, 255, 0.15);\n  border-radius: 6px;\n  padding: 5px 8px;\n  font-size: 11px;\n  color: #f1f5f9;\n  font-family: monospace;\n}\n\n.agy-config-input:focus {\n  outline: none;\n  border-color: #38bdf8;\n}\n\n.agy-mic-meter-box {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  font-size: 10px;\n  color: #94a3b8;\n}\n\n.agy-meter-outer {\n  flex: 1;\n  height: 6px;\n  background: rgba(255, 255, 255, 0.08);\n  border-radius: 3px;\n  overflow: hidden;\n}\n\n.agy-meter-inner {\n  height: 100%;\n  width: 0%;\n  background: linear-gradient(90deg, #10b981, #38bdf8, #f59e0b, #ef4444);\n  transition: width 0.05s ease;\n}\n\n.agy-logs-window {\n  flex: 1;\n  padding: 10px 12px;\n  background: #090a0f;\n  overflow-y: auto;\n  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;\n  font-size: 11px;\n  line-height: 1.5;\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n\n.agy-log-line { margin-bottom: 4px; }\n.agy-log-ts { color: #64748b; margin-right: 6px; }\n.agy-tag-info { color: #94a3b8; font-weight: 600; }\n.agy-tag-mic { color: #38bdf8; font-weight: 600; }\n.agy-tag-ws { color: #818cf8; font-weight: 600; }\n.agy-tag-vad { color: #f59e0b; font-weight: 600; }\n.agy-tag-error { color: #ef4444; font-weight: 700; }\n.agy-tag-success { color: #10b981; font-weight: 600; }\n.agy-tag-model { color: #c084fc; font-weight: 600; }\n\n@keyframes agy-pulse {\n  0% { transform: scale(1); opacity: 0.85; }\n  50% { transform: scale(1.08); opacity: 1; }\n  100% { transform: scale(1); opacity: 0.85; }\n}\n\n@keyframes agy-speaking {\n  0% { transform: scale(1); box-shadow: 0 0 16px rgba(192, 132, 252, 0.4); }\n  100% { transform: scale(1.07); box-shadow: 0 0 28px rgba(192, 132, 252, 0.85); }\n}\n';
  (document.head || document.documentElement).appendChild(style);
})();

// The Butler (Gemini Live) - Chrome & Safari Content Script
(() => {
  if (window.__antigravityVoiceButlerMounted) return;
  window.__antigravityVoiceButlerMounted = true;

  const DEFAULT_WS_URL = "wss://butler.retake.cloud/ws";
  let targetWsUrl = localStorage.getItem("agy_voice_ws_url") || DEFAULT_WS_URL;

  let ws = null;
  let audioCtx = null;
  let micStream = null;
  let spNode = null;
  let isRecording = false;
  let scheduledSources = [];
  let nextStartTime = 0;
  let activePlayCount = 0;
  let currentConvId = "";
  let currentConvTitle = "";
  let lastObservedUrl = window.location.href;

  const isTopFrame = (window === window.top);
  var lastSubmitTime = 0;
  var lastPlaybackEndTime = 0;

  // 1. Build DOM Elements (Top Frame Only)
  let container = null;
  let drawer = null;
  let logsWindow = null;
  let statusPill = null;
  let voiceBtn = null;
  let voiceBadge = null;
  let micMeterInner = null;
  let micMeterVal = null;
  let serviceInput = null;

  if (isTopFrame) {
    container = document.createElement("div");
    container.id = "agy-voice-container";
    container.innerHTML = `
      <div id="agy-voice-badge">The Butler (Cmd+Shift+V)</div>
      <div id="agy-voice-console-btn" title="The Butler Debug Console (Cmd+Shift+D)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4 17 10 11 4 5"></polyline>
          <line x1="12" y1="19" x2="20" y2="19"></line>
        </svg>
      </div>
      <div id="agy-voice-btn" title="Talk with The Butler (Cmd+Shift+V)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
          <line x1="12" y1="19" x2="12" y2="22"></line>
        </svg>
      </div>
    `;

    drawer = document.createElement("div");
    drawer.id = "agy-voice-console-drawer";
    drawer.innerHTML = `
      <div class="agy-console-header">
        <div class="agy-console-title">
          <span>🎙️ The Butler v2.0.3 (Native Neural Voice)</span>
          <span id="agy-console-status" class="agy-console-status-pill">Idle</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <button id="agy-btn-close-console" class="agy-btn-action" style="padding:2px 7px;">✕</button>
        </div>
      </div>
      <div class="agy-console-actions">
        <button id="agy-btn-test-mic" class="agy-btn-action highlight">Test Mic (5s)</button>
        <button id="agy-btn-test-gw" class="agy-btn-action">Test Live Service</button>
        <button id="agy-btn-scan-dom" class="agy-btn-action">Scan DOM</button>
        <button id="agy-btn-test-inject" class="agy-btn-action highlight">Test Inject "okay"</button>
        <button id="agy-btn-copy-logs" class="agy-btn-action">Copy Logs</button>
        <button id="agy-btn-clear-logs" class="agy-btn-action">Clear</button>
      </div>
      <div class="agy-config-box">
        <div class="agy-mic-meter-box">
          <span>Mic Volume:</span>
          <div class="agy-meter-outer"><div id="agy-mic-meter-inner" class="agy-meter-inner"></div></div>
          <span id="agy-meter-val">0%</span>
        </div>
        <div class="agy-config-input-row" style="margin-top:4px;">
          <input id="agy-service-url-input" class="agy-config-input" style="flex:1;" placeholder="wss://butler.retake.cloud/ws" value="${targetWsUrl}" />
          <button id="agy-btn-save-config" class="agy-btn-action highlight">Save & Reconnect</button>
        </div>
      </div>
      <div id="agy-console-logs-window" class="agy-logs-window"></div>
    `;

    const mount = () => {
      const target = document.body || document.documentElement;
      if (target) {
        if (!document.getElementById("agy-voice-container")) {
          target.appendChild(container);
        }
        if (!document.getElementById("agy-voice-console-drawer")) {
          target.appendChild(drawer);
        }
      }
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mount);
    } else {
      mount();
    }

    logsWindow = drawer.querySelector("#agy-console-logs-window");
    statusPill = drawer.querySelector("#agy-console-status");
    voiceBtn = container.querySelector("#agy-voice-btn");
    voiceBadge = container.querySelector("#agy-voice-badge");
    micMeterInner = drawer.querySelector("#agy-mic-meter-inner");
    micMeterVal = drawer.querySelector("#agy-meter-val");
    serviceInput = drawer.querySelector("#agy-service-url-input");
  }

  // --- CHILD IFRAME HANDLER ---
  let lastProcessedInjectId = "";
  let lastProcessedInjectTime = 0;

  if (!isTopFrame) {
    window.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
        const k = (e.key || "").toLowerCase();
        const code = e.code || "";
        if (k === "v" || code === "KeyV") {
          e.preventDefault();
          e.stopPropagation();
          try { window.top.postMessage({ type: "AGY_TOGGLE_VOICE" }, "*"); } catch (_) {}
        } else if (k === "d" || code === "KeyD") {
          e.preventDefault();
          e.stopPropagation();
          try { window.top.postMessage({ type: "AGY_TOGGLE_DRAWER" }, "*"); } catch (_) {}
        }
      }
    }, true);

    window.addEventListener("message", (event) => {
      if (event.data && event.data.type === "AGY_SCAN_DOM") {
        const input = findChatInputElement();
        const send = findSendButton(input);
        if (input) {
          try {
            window.top.postMessage({
              type: "AGY_SCAN_RESULT",
              found: true,
              tag: input.tagName.toLowerCase(),
              label: input.getAttribute("aria-label") || input.getAttribute("data-lexical-editor") || "contenteditable",
              hasSend: !!send,
              frameUrl: window.location.href
            }, "*");
          } catch (_) {}
        }
      } else if (event.data && event.data.type === "AGY_INJECT_CHAT") {
        const { id, prompt, submit } = event.data;
        const now = Date.now();
        if (id && id === lastProcessedInjectId) return;
        if (now - lastProcessedInjectTime < 500) return;
        lastProcessedInjectId = id || "";
        lastProcessedInjectTime = now;

        const ok = performInjection(prompt, submit);
        if (ok) {
          try {
            window.top.postMessage({
              type: "AGY_INJECT_RESULT",
              success: true,
              prompt,
              submit,
              frameUrl: window.location.href
            }, "*");
          } catch (_) {}
        }
      }
    });
    return; // Child frames only inject DOM and do not run audio/UI
  }

  function log(msg, tag = "info") {
    const time = new Date().toLocaleTimeString().split(" ")[0];
    const line = document.createElement("div");
    line.className = "agy-log-line";
    line.innerHTML = `<span class="agy-log-ts">[${time}]</span><span class="agy-tag-${tag}">[${tag.toUpperCase()}]</span> ${escapeHtml(msg)}`;
    if (logsWindow) {
      logsWindow.appendChild(line);
      logsWindow.scrollTop = logsWindow.scrollHeight;
    }
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function updateStatus(state, label) {
    if (statusPill) {
      statusPill.className = `agy-console-status-pill ${state}`;
      statusPill.textContent = label;
    }
    if (voiceBtn) {
      voiceBtn.className = state;
    }
    if (voiceBadge) {
      voiceBadge.textContent = label;
    }
  }

  // 3. Exact Antigravity Web Conversation Detection (?p=c%2F<uuid> & /c/<uuid>)
  function detectActiveConv() {
    let cid = "";
    let title = "";

    try {
      // Decode full URL to extract Antigravity web format (?p=c/uuid) or direct path (/c/uuid)
      const fullUrl = decodeURIComponent(window.location.href);
      const urlMatch = fullUrl.match(/[?&]p=c\/([0-9a-f-]{36})/i) ||
                       fullUrl.match(/\/c\/([0-9a-f-]{36})/i) ||
                       fullUrl.match(/c%2F([0-9a-f-]{36})/i);

      if (urlMatch) {
        cid = urlMatch[1];
      }

      // Check DOM attributes fallback
      if (!cid) {
        const view = document.querySelector('[data-testid="conversation-view"]');
        cid = view?.getAttribute("data-cascade-id") || "";
      }

      // Extract conversation title from breadcrumbs or page title
      const breadcrumbs = document.querySelectorAll('header span, nav span, [class*="breadcrumb"]');
      for (const b of breadcrumbs) {
        const txt = (b.innerText || "").trim();
        if (txt.includes(" / ") || (txt.includes("/") && txt.length > 3)) {
          const parts = txt.split("/").map(s => s.trim()).filter(Boolean);
          if (parts.length > 0) {
            title = parts[parts.length - 1];
            break;
          }
        }
      }

      if (!title && document.title) {
        const docT = document.title.replace(/\s*-\s*Antigravity\s*$/i, "").trim();
        if (docT && docT.toLowerCase() !== "antigravity") {
          title = docT;
        }
      }
    } catch (e) {
      console.error("[The Butler] Error detecting active conversation:", e);
    }

    if (cid || title) {
      return {
        id: cid,
        title: title || (cid ? `Chat ${cid.slice(0, 8)}` : "Active Chat")
      };
    }
    return null;
  }

  function syncActiveChat() {
    const conv = detectActiveConv();
    if (conv && (conv.id || conv.title)) {
      const isNewId = conv.id && conv.id !== currentConvId;
      const isNewTitle = conv.title && conv.title !== currentConvTitle;

      if (isNewId || isNewTitle) {
        if (conv.id) currentConvId = conv.id;
        if (conv.title) currentConvTitle = conv.title;
        log(`Brain context bound: ${currentConvTitle} (${currentConvId || "no id"})`, "info");

        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "switch_active_conversation",
            conversation_id: currentConvId,
            title: currentConvTitle
          }));
        }
      }
    }
  }

  // SPA navigation observer: detects tab/chat switches without page reload
  setInterval(() => {
    if (window.location.href !== lastObservedUrl) {
      lastObservedUrl = window.location.href;
      syncActiveChat();
    }
  }, 750);

  // 4. In-DOM Typing & Execution (write_to_chat tool)
  function queryDeepAll(selector, root = document, results = [], maxDepth = 15, currentDepth = 0) {
    if (!root || currentDepth > maxDepth) return results;
    try {
      const matches = root.querySelectorAll?.(selector);
      if (matches) {
        for (const m of matches) {
          if ((!container || !container.contains(m)) && (!drawer || !drawer.contains(m))) {
            results.push(m);
          }
        }
      }
    } catch (_) {}

    try {
      const all = root.querySelectorAll?.('*') || [];
      for (const el of all) {
        if (el.shadowRoot) {
          queryDeepAll(selector, el.shadowRoot, results, maxDepth, currentDepth + 1);
        }
      }
    } catch (_) {}

    return results;
  }

  function queryDeepFirst(selector, root = document) {
    const list = queryDeepAll(selector, root);
    return list.length > 0 ? list[0] : null;
  }

  function findChatInputElement() {
    const exactSelectors = [
      '[data-testid="agent-input-box"] [data-lexical-editor="true"]',
      '#antigravity\\.agentSidePanelInputBox [data-lexical-editor="true"]',
      'div[aria-label="Message input"][data-lexical-editor="true"]',
      'div[contenteditable="true"][data-lexical-editor="true"]',
      '[data-testid="agent-input-box"] [aria-label="Message input"]',
      '[data-testid="agent-input-box"] div[contenteditable="true"]',
      'div[aria-label="Message input"]',
      '[data-lexical-editor="true"]',
      'div[contenteditable="true"][role="combobox"]',
      'div[contenteditable="true"]',
      'textarea',
      'input[type="text"]'
    ];

    for (const sel of exactSelectors) {
      const el = queryDeepFirst(sel);
      if (el) return el;
    }

    if (document.activeElement && (document.activeElement.isContentEditable || document.activeElement.tagName === "TEXTAREA" || document.activeElement.tagName === "INPUT")) {
      if ((!container || !container.contains(document.activeElement)) && (!drawer || !drawer.contains(document.activeElement))) {
        return document.activeElement;
      }
    }

    return null;
  }

  function findSendButton(inputEl) {
    const selectors = [
      '[data-testid="send-button"]',
      'button[aria-label="Send message"]',
      'button[data-testid="send-button"]',
      '[data-testid="agent-input-box"] button[aria-label*="Send"]',
      '#antigravity\\.agentSidePanelInputBox button[aria-label*="Send"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Submit"]'
    ];

    for (const sel of selectors) {
      const btn = queryDeepFirst(sel);
      if (btn) {
        const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
        if (aria.includes("feedback")) continue;
        return btn;
      }
    }

    const parent = inputEl?.closest('[data-testid="agent-input-box"], #antigravity\\.agentSidePanelInputBox, div.relative, form, footer') || inputEl?.parentElement;
    if (parent) {
      const btns = parent.querySelectorAll('button');
      for (const b of btns) {
        if ((container && container.contains(b)) || (drawer && drawer.contains(b))) continue;
        const aria = (b.getAttribute("aria-label") || "").toLowerCase();
        const testId = (b.getAttribute("data-testid") || "").toLowerCase();
        if (aria.includes("feedback") || testId.includes("feedback")) continue;
        if (testId.includes("send") || aria.includes("send") || aria.includes("submit")) {
          return b;
        }
      }
    }
    return null;
  }

  function triggerReactClick(element) {
    if (!element) return false;
    element.removeAttribute("disabled");
    element.disabled = false;

    // Single authoritative native click
    try {
      element.click();
      return true;
    } catch (_) {}

    try {
      const evt = new MouseEvent("click", { bubbles: true, cancelable: true, view: window });
      element.dispatchEvent(evt);
      return true;
    } catch (_) {}

    return false;
  }

  function triggerEnter(element) {
    if (!element) return;
    try {
      element.focus();
      const eventInit = {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        charCode: 13,
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      };
      element.dispatchEvent(new KeyboardEvent("keydown", eventInit));
      element.dispatchEvent(new KeyboardEvent("keypress", eventInit));
      element.dispatchEvent(new KeyboardEvent("keyup", eventInit));
    } catch (_) {}
  }

  function performInjection(prompt, submit = false) {
    const el = findChatInputElement();
    if (!el) return false;
    if (el.ownerDocument !== document) return false;

    try { el.focus(); } catch (_) {}

    if (el.tagName.toLowerCase() === "textarea" || el.tagName.toLowerCase() === "input") {
      el.value = prompt;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      // Select all contents and replace with prompt in ONE clean operation
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (_) {}

      let ok = false;
      try {
        ok = document.execCommand("insertText", false, prompt);
      } catch (_) {}

      if (!ok) {
        el.innerHTML = `<p dir="auto"><span data-lexical-text="true">${escapeHtml(prompt)}</span></p>`;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }

    if (submit) {
      const now = Date.now();
      if (now - lastSubmitTime < 2000) return true;
      lastSubmitTime = now;

      setTimeout(() => {
        const btn = findSendButton(el);
        if (btn) {
          triggerReactClick(btn);
        } else {
          triggerEnter(el);
        }
      }, 150);
    }

    return true;
  }

  function broadcastToFrames(msg) {
    for (let i = 0; i < window.frames.length; i++) {
      try {
        window.frames[i].postMessage(msg, "*");
      } catch (_) {}
    }
  }

  async function writeToCurrentChat(prompt, submit = false) {
    log(`[write_to_chat] Drafting: "${prompt.slice(0, 45)}..." (submit=${submit})`, "info");

    // 1. Try Mac Native Companion first if running
    try {
      const resp = await fetch("http://127.0.0.1:8009/type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, submit })
      });
      if (resp.ok) {
        log("Pasted & submitted via Mac Native Companion!", "success");
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "client_write_success", prompt, submit }));
        }
        return;
      }
    } catch (_) {}

    // 2. Check local top-frame DOM
    if (performInjection(prompt, submit)) {
      log("Chat input located & injected directly in main frame!", "success");
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "client_write_success", prompt, submit }));
      }
      return;
    }

    // 3. Broadcast to nested iframes with unique message ID
    log("Chat input not in top frame; broadcasting to nested iframes...", "info");
    let resolved = false;

    const onResult = (event) => {
      if (event.data?.type === "AGY_INJECT_RESULT" && event.data?.success) {
        resolved = true;
        window.removeEventListener("message", onResult);
        log("Chat input located & message injected inside nested iframe!", "success");
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "client_write_success", prompt, submit }));
        }
      }
    };
    window.addEventListener("message", onResult);

    const msgId = "inj_" + Date.now();
    broadcastToFrames({ type: "AGY_INJECT_CHAT", id: msgId, prompt, submit });

    setTimeout(() => {
      if (!resolved) {
        window.removeEventListener("message", onResult);
        log("Chat input element not found in DOM (Start mac_companion.py for native keystrokes)", "error");
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "client_write_failed",
            error: "Input element not found in DOM or nested frames",
            prompt,
            submit
          }));
        }
      }
    }, 2500);
  }

  // 5. Audio Pipeline
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

  function updateVuMeter(floatData) {
    let sum = 0;
    for (let i = 0; i < floatData.length; i++) {
      sum += floatData[i] * floatData[i];
    }
    const rms = Math.sqrt(sum / floatData.length);
    const pct = Math.min(100, Math.round(rms * 400));
    if (micMeterInner) micMeterInner.style.width = `${pct}%`;
    if (micMeterVal) micMeterVal.textContent = `${pct}%`;
  }

  function stopPlayback() {
    for (let i = 0; i < scheduledSources.length; i++) {
      try { scheduledSources[i].stop(); } catch (_) {}
    }
    scheduledSources = [];
    activePlayCount = 0;
    if (audioCtx) nextStartTime = audioCtx.currentTime;
    if (isRecording) {
      updateStatus("listening", "Listening...");
    }
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

    activePlayCount++;
    updateStatus("speaking", "Gemini Speaking...");

    src.onended = () => {
      const idx = scheduledSources.indexOf(src);
      if (idx > -1) scheduledSources.splice(idx, 1);
      activePlayCount = Math.max(0, activePlayCount - 1);
      if (activePlayCount === 0) {
        lastPlaybackEndTime = Date.now();
        if (isRecording) {
          updateStatus("listening", "Listening...");
        }
      }
    };
  }

  // 6. Voice Session Management
  async function startSession() {
    updateStatus("connecting", "Connecting...");

    const conv = detectActiveConv();
    const cid = conv?.id || "";
    const targetUrl = targetWsUrl + (cid ? "?conversation_id=" + encodeURIComponent(cid) : "");
    log(`Connecting to ${targetUrl}...`, "ws");

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      log("Microphone stream initialized", "mic");

      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!audioCtx) audioCtx = new AudioCtxClass();
      if (audioCtx.state === "suspended") await audioCtx.resume();

      ws = new WebSocket(targetUrl);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        isRecording = true;
        updateStatus("listening", "Listening...");
        log("WebSocket connected. Voice session active.", "success");
        syncActiveChat();

        const source = audioCtx.createMediaStreamSource(micStream);
        spNode = audioCtx.createScriptProcessor(2048, 1, 1);
        const actualSampleRate = audioCtx.sampleRate;

        spNode.onaudioprocess = (e) => {
          if (!isRecording) return;
          const inputData = e.inputBuffer.getChannelData(0);
          updateVuMeter(inputData);

          // Acoustic echo gate: do NOT send mic audio while Butler is playing speech (or during 300ms room decay)
          if (activePlayCount > 0 || (Date.now() - lastPlaybackEndTime < 300)) {
            return;
          }

          if (ws && ws.readyState === WebSocket.OPEN) {
            const downsampled = downsample(inputData, actualSampleRate, 16000);
            ws.send(toInt16(downsampled));
          }
        };

        source.connect(spNode);
        // Connect to silent gain node so script processor runs without playing mic back into speakers
        const muteGain = audioCtx.createGain();
        muteGain.gain.value = 0;
        spNode.connect(muteGain);
        muteGain.connect(audioCtx.destination);
      };

      ws.onmessage = async (e) => {
        if (typeof e.data === "string") {
          try {
            const m = JSON.parse(e.data);
            if (m.type === "gemini") {
              log(`Gemini: ${m.text}`, "model");
            } else if (m.type === "user") {
              log(`You: ${m.text}`, "mic");
            } else if (m.type === "tool_start") {
              log(`Tool executing: ${m.name} (${JSON.stringify(m.args || {})})`, "vad");
            } else if (m.type === "tool_call") {
              log(`Tool result: ${m.name}`, "success");
            } else if (m.type === "client_write_to_chat") {
              const targetId = m.conversation_id || "";
              if (targetId && currentConvId && targetId !== currentConvId) {
                log(`Target ${targetId.slice(0, 8)} differs from current tab ${currentConvId.slice(0, 8)}. Writing to current view.`, "vad");
              }
              writeToCurrentChat(m.prompt, m.submit);
            } else if (m.type === "active_conversation_updated") {
              currentConvId = m.conversation_id;
              currentConvTitle = m.title || "Active Chat";
              log(`Context bound to: ${currentConvTitle}`, "info");
            } else if (m.type === "interrupted") {
              log("Speech interrupted by user", "vad");
              stopPlayback();
            } else if (m.type === "turn_complete") {
              if (activePlayCount === 0 && isRecording) {
                updateStatus("listening", "Listening...");
              }
            } else if (m.type === "error") {
              log(`Server error: ${m.error}`, "error");
            }
          } catch (_) {}
        } else {
          let raw = e.data;
          if (raw instanceof Blob) raw = await raw.arrayBuffer();
          play24kPcm(raw);
        }
      };

      ws.onerror = (err) => {
        log("WebSocket error occurred", "error");
        updateStatus("error", "Connection Error");
      };

      ws.onclose = () => {
        log("WebSocket connection closed", "ws");
        stopSession();
      };
    } catch (err) {
      log(`Failed to start: ${err.message || err}`, "error");
      updateStatus("error", "Permission Denied");
      setTimeout(() => {
        updateStatus("", "Idle");
      }, 3000);
    }
  }

  function stopSession() {
    isRecording = false;
    stopPlayback();

    if (spNode) {
      try { spNode.disconnect(); } catch (_) {}
      spNode = null;
    }

    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }

    if (ws) {
      try { ws.close(); } catch (_) {}
      ws = null;
    }

    if (micMeterInner) micMeterInner.style.width = "0%";
    if (micMeterVal) micMeterVal.textContent = "0%";

    updateStatus("", "Idle");
    log("Voice session ended", "info");
  }

  function toggleVoice() {
    if (isRecording || ws) {
      stopSession();
    } else {
      startSession();
    }
  }

  function toggleDrawer() {
    const isVisible = drawer.style.display === "flex";
    if (isVisible) {
      drawer.style.setProperty("display", "none", "important");
    } else {
      drawer.style.setProperty("display", "flex", "important");
      log("Console drawer opened", "info");
    }
  }

  // 7. Drawer Controls & Diagnostic Actions
  voiceBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleVoice();
  });

  const consoleBtn = container.querySelector("#agy-voice-console-btn");
  if (consoleBtn) {
    consoleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDrawer();
    });
  }

  const closeBtn = drawer.querySelector("#agy-btn-close-console");
  if (closeBtn) {
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDrawer();
    });
  }

  drawer.querySelector("#agy-btn-test-mic").addEventListener("click", async () => {
    if (isRecording) {
      log("Voice session is already running", "info");
      return;
    }
    log("Starting 5-second mic diagnostic test...", "mic");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      const testCtx = new AudioCtxClass();
      const src = testCtx.createMediaStreamSource(stream);
      const proc = testCtx.createScriptProcessor(2048, 1, 1);

      proc.onaudioprocess = (e) => {
        updateVuMeter(e.inputBuffer.getChannelData(0));
      };
      src.connect(proc);
      proc.connect(testCtx.destination);

      setTimeout(() => {
        proc.disconnect();
        src.disconnect();
        stream.getTracks().forEach(t => t.stop());
        testCtx.close();
        if (micMeterInner) micMeterInner.style.width = "0%";
        if (micMeterVal) micMeterVal.textContent = "0%";
        log("Mic test complete. Hardware input is working!", "success");
      }, 5000);
    } catch (err) {
      log(`Mic test failed: ${err.message}`, "error");
    }
  });

  drawer.querySelector("#agy-btn-test-gw").addEventListener("click", () => {
    log(`Testing connectivity to ${targetWsUrl}...`, "ws");
    const t0 = performance.now();
    try {
      const testWs = new WebSocket(targetWsUrl);
      testWs.onopen = () => {
        const ping = Math.round(performance.now() - t0);
        log(`Live Service online! Ping: ${ping}ms`, "success");
        testWs.close();
      };
      testWs.onerror = () => {
        log(`Failed to reach ${targetWsUrl}`, "error");
      };
    } catch (e) {
      log(`Service test exception: ${e.message}`, "error");
    }
  });

  const scanDomBtn = drawer.querySelector("#agy-btn-scan-dom");
  if (scanDomBtn) {
    scanDomBtn.addEventListener("click", () => {
      log("--- Starting Deep DOM Diagnostic Scan ---", "info");
      let shadowCount = 0;
      let iframeCount = 0;
      function scan(root, depth = 0) {
        if (!root || depth > 15) return;
        const all = root.querySelectorAll?.("*") || [];
        for (const node of all) {
          if (node.shadowRoot) {
            shadowCount++;
            scan(node.shadowRoot, depth + 1);
          }
          if (node.tagName === "IFRAME") {
            iframeCount++;
            try {
              const doc = node.contentDocument || node.contentWindow?.document;
              if (doc) scan(doc, depth + 1);
            } catch (_) {}
          }
        }
      }
      scan(document);
      log(`DOM Scan complete: pierced ${shadowCount} Shadow Root(s) and ${iframeCount} Iframe(s)`, "info");
      const foundInput = findChatInputElement();
      if (foundInput) {
        log(`✓ Target input box located: <${foundInput.tagName.toLowerCase()} ${foundInput.getAttribute("aria-label") || foundInput.getAttribute("data-lexical-editor") || "contenteditable"}>`, "success");
      } else {
        log("No matching input in main frame; broadcasting scan to nested frames...", "info");
      }
      const foundSend = findSendButton(foundInput);
      if (foundSend) {
        log(`✓ Target send button located: <${foundSend.tagName.toLowerCase()} ${foundSend.getAttribute("data-testid") || foundSend.getAttribute("aria-label") || "button"}>`, "success");
      }

      // Broadcast scan to all nested frames
      const onScanResult = (e) => {
        if (e.data && e.data.type === "AGY_SCAN_RESULT" && e.data.found) {
          log(`✓ Target input located inside nested frame: <${e.data.tag} ${e.data.label}> (Send button: ${e.data.hasSend ? "Found" : "Missing"})`, "success");
        }
      };
      window.addEventListener("message", onScanResult);
      broadcastToFrames({ type: "AGY_SCAN_DOM" });
      setTimeout(() => window.removeEventListener("message", onScanResult), 3000);
    });
  }

  const testInjectBtn = drawer.querySelector("#agy-btn-test-inject");
  if (testInjectBtn) {
    testInjectBtn.addEventListener("click", () => {
      log("Manual Test Inject clicked: attempting to inject 'okay' into active chat...", "info");
      writeToCurrentChat("okay", true);
    });
  }

  drawer.querySelector("#agy-btn-copy-logs").addEventListener("click", () => {
    if (!logsWindow) return;
    navigator.clipboard.writeText(logsWindow.innerText || "");
    log("Logs copied to clipboard!", "success");
  });

  drawer.querySelector("#agy-btn-clear-logs").addEventListener("click", () => {
    if (logsWindow) logsWindow.innerHTML = "";
  });

  drawer.querySelector("#agy-btn-save-config").addEventListener("click", () => {
    if (serviceInput && serviceInput.value.trim()) {
      targetWsUrl = serviceInput.value.trim();
      localStorage.setItem("agy_voice_ws_url", targetWsUrl);
      log(`Service URL updated to: ${targetWsUrl}`, "success");
      if (isRecording) {
        stopSession();
        setTimeout(startSession, 500);
      }
    }
  });

  // 8. Keyboard Shortcuts (Capture phase + Cross-frame relay)
  window.addEventListener("message", (e) => {
    if (e.data?.type === "AGY_TOGGLE_VOICE") {
      toggleVoice();
    } else if (e.data?.type === "AGY_TOGGLE_DRAWER") {
      toggleDrawer();
    }
  });

  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
      const k = (e.key || "").toLowerCase();
      const code = e.code || "";
      if (k === "v" || code === "KeyV") {
        e.preventDefault();
        e.stopPropagation();
        toggleVoice();
      } else if (k === "d" || code === "KeyD") {
        e.preventDefault();
        e.stopPropagation();
        toggleDrawer();
      }
    }
  }, true);

  log("The Butler v2.0.9 ready with active tool dispatch and global shortcuts.", "info");
})();
