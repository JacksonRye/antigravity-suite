// Antigravity Voice Butler - Side Panel Controller

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const spFeed = document.getElementById("spFeed");
const spPrompt = document.getElementById("spPrompt");
const spMicBtn = document.getElementById("spMicBtn");
const spInterruptBtn = document.getElementById("spInterruptBtn");
const spHandsFreeCheck = document.getElementById("spHandsFreeCheck");
const clearTranscriptBtn = document.getElementById("clearTranscriptBtn");
const spTextForm = document.getElementById("spTextForm");
const spTextInput = document.getElementById("spTextInput");
const openSettingsBtn = document.getElementById("openSettingsBtn");
const spOrbGlow = document.getElementById("spOrbGlow");

let isMicActive = false;
let currentUserMsgDiv = null;
let currentButlerMsgDiv = null;

// Initialize Settings
chrome.storage.local.get({ handsFree: false }, (data) => {
  spHandsFreeCheck.checked = !!data.handsFree;
});

// Settings button
openSettingsBtn.addEventListener("click", () => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL("options.html"));
  }
});

// Clear transcript
clearTranscriptBtn.addEventListener("click", () => {
  spFeed.innerHTML = `
    <div class="sp-message sp-assistant welcome">
      <div class="sp-avatar">✨</div>
      <div class="sp-msg-content">
        <div class="sp-text">Transcript cleared. Butler is listening.</div>
      </div>
    </div>
  `;
  currentUserMsgDiv = null;
  currentButlerMsgDiv = null;
});

// Mic toggle button (controls active tab mic)
spMicBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_MIC" }).catch(() => {});
  }
});

// Interrupt button
spInterruptBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "STOP_PLAYBACK" }).catch(() => {});
  }
  updateStatus("ready", "Interrupted");
});

// Hands-free toggle
spHandsFreeCheck.addEventListener("change", async (e) => {
  const handsFree = e.target.checked;
  await chrome.storage.local.set({ handsFree });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "SETTINGS_UPDATED", settings: { handsFree } }).catch(() => {});
  }
});

// Text Form Submit
spTextForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = spTextInput.value.trim();
  if (!text) return;
  spTextInput.value = "";

  appendMessage("user", text);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "SEND_TEXT", text }).catch(() => {});
  }
});

// Handle incoming messages from Content Script or Background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "BUTLER_STATUS") {
    updateStatus(msg.state, msg.text);
  } else if (msg.type === "user") {
    if (currentUserMsgDiv) {
      currentUserMsgDiv.textContent += msg.text;
    } else {
      currentUserMsgDiv = appendMessage("user", msg.text);
    }
    spFeed.scrollTop = spFeed.scrollHeight;
  } else if (msg.type === "gemini") {
    if (currentButlerMsgDiv) {
      currentButlerMsgDiv.textContent += msg.text;
    } else {
      currentButlerMsgDiv = appendMessage("assistant", msg.text);
    }
    spFeed.scrollTop = spFeed.scrollHeight;
  } else if (msg.type === "turn_complete") {
    currentUserMsgDiv = null;
    currentButlerMsgDiv = null;
  } else if (msg.type === "interrupted") {
    currentUserMsgDiv = null;
    currentButlerMsgDiv = null;
    updateStatus("ready", "Interrupted");
  } else if (msg.type === "tool_call" || msg.type === "tool_start") {
    appendToolEvent(msg.name, msg.args, msg.result);
  }
});

function updateStatus(state, text) {
  statusText.textContent = text || state;
  statusDot.className = `sp-status-dot ${state}`;

  if (state === "listening") {
    spMicBtn.classList.add("active");
    spPrompt.textContent = "Listening to your voice...";
    spOrbGlow.style.transform = "scale(1.2)";
  } else if (state === "thinking") {
    spMicBtn.classList.remove("active");
    spPrompt.textContent = "Gemini is processing...";
    spOrbGlow.style.transform = "scale(1.0)";
  } else if (state === "speaking") {
    spMicBtn.classList.remove("active");
    spPrompt.textContent = "Butler speaking... tap to interrupt";
    spOrbGlow.style.transform = "scale(1.35)";
  } else {
    spMicBtn.classList.remove("active");
    spPrompt.textContent = "Tap mic or use in-page floating orb";
    spOrbGlow.style.transform = "scale(1.0)";
  }
}

function appendMessage(role, text) {
  const msgEl = document.createElement("div");
  msgEl.className = `sp-message sp-${role}`;

  const avatar = document.createElement("div");
  avatar.className = "sp-avatar";
  avatar.textContent = role === "user" ? "👤" : "✨";

  const contentWrap = document.createElement("div");
  contentWrap.className = "sp-msg-content";

  const textEl = document.createElement("div");
  textEl.className = "sp-text";
  textEl.textContent = text;

  contentWrap.appendChild(textEl);
  msgEl.appendChild(avatar);
  msgEl.appendChild(contentWrap);

  spFeed.appendChild(msgEl);
  spFeed.scrollTop = spFeed.scrollHeight;
  return textEl;
}

function appendToolEvent(toolName, args, result) {
  const eventEl = document.createElement("div");
  eventEl.style.fontSize = "11px";
  eventEl.style.padding = "4px 8px";
  eventEl.style.margin = "4px 0";
  eventEl.style.background = "rgba(56, 189, 248, 0.1)";
  eventEl.style.border = "1px solid rgba(56, 189, 248, 0.2)";
  eventEl.style.borderRadius = "6px";
  eventEl.style.color = "#38bdf8";

  let desc = `🛠️ <strong>${toolName}</strong>`;
  if (toolName === "write_to_chat") {
    desc += `: Drafted prompt "${(args?.prompt || "").slice(0, 40)}..." (submit=${args?.submit})`;
  } else if (toolName === "search_web") {
    desc += `: Searched "${args?.query || ""}"`;
  } else if (toolName === "remember_fact") {
    desc += `: Stored memory in [${args?.category || ""}]`;
  }

  eventEl.innerHTML = desc;
  spFeed.appendChild(eventEl);
  spFeed.scrollTop = spFeed.scrollHeight;
}
