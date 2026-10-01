// Antigravity Voice Butler - Background Service Worker (Manifest V3)

const DEFAULT_SETTINGS = {
  serverUrl: "wss://butler.retake.cloud/ws",
  autoConnect: false,
  handsFree: false,
  orbVisible: true,
  whitelistedHosts: ["*"],
  voiceRate: 1.0,
};

// Initialize settings on install
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(null);
  const toSet = {};
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (existing[k] === undefined) {
      toSet[k] = v;
    }
  }
  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }
});

// Toggle Butler UI when the extension icon is clicked in toolbar
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_ORB" });
  } catch (err) {
    // If content script was not already running on the tab, dynamically inject it
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["content.css"],
      });
    } catch (e) {
      console.warn("[VoiceButler Background] Script injection failed:", e);
    }
  }
// Active tab and URL synchronization across conversation switches
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: "SYNC_CONVERSATION" }).catch(() => {});
    }
  } catch (_) {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    chrome.tabs.sendMessage(tabId, { type: "SYNC_CONVERSATION" }).catch(() => {});
  }
});

// Broadcast messages to all active extension contexts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === "background") {
    handleBackgroundMessage(message, sender).then(sendResponse);
    return true; // Keep message channel open for async response
  }
});

async function handleBackgroundMessage(message, sender) {
  switch (message.type) {
    case "GET_SETTINGS": {
      const settings = await chrome.storage.local.get(null);
      return { success: true, settings: { ...DEFAULT_SETTINGS, ...settings } };
    }
    case "SAVE_SETTINGS": {
      await chrome.storage.local.set(message.settings || {});
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: "SETTINGS_UPDATED", settings: message.settings }).catch(() => {});
        }
      }
      return { success: true };
    }
    case "RELAY_TO_TAB": {
      if (message.tabId) {
        chrome.tabs.sendMessage(message.tabId, message.payload).catch(() => {});
      } else {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab?.id) {
          chrome.tabs.sendMessage(activeTab.id, message.payload).catch(() => {});
        }
      }
      return { success: true };
    }
    default:
      return { success: false, error: "Unknown message type" };
  }
}
