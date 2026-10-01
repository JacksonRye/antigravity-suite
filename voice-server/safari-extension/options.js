// Options Page Controller

const serverUrlInput = document.getElementById("serverUrl");
const whitelistedHostsInput = document.getElementById("whitelistedHosts");
const orbVisibleInput = document.getElementById("orbVisible");
const autoConnectInput = document.getElementById("autoConnect");
const handsFreeInput = document.getElementById("handsFree");
const settingsForm = document.getElementById("settingsForm");
const toast = document.getElementById("toast");

// Load stored settings
document.addEventListener("DOMContentLoaded", async () => {
  const settings = await chrome.storage.local.get({
    serverUrl: "ws://localhost:8000/ws",
    whitelistedHosts: ["localhost", "127.0.0.1", "antigravity.google"],
    orbVisible: true,
    autoConnect: false,
    handsFree: false,
  });

  serverUrlInput.value = settings.serverUrl;
  whitelistedHostsInput.value = settings.whitelistedHosts.join("\n");
  orbVisibleInput.checked = !!settings.orbVisible;
  autoConnectInput.checked = !!settings.autoConnect;
  handsFreeInput.checked = !!settings.handsFree;
});

// Save settings
settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const hosts = whitelistedHostsInput.value
    .split("\n")
    .map((h) => h.trim())
    .filter((h) => h.length > 0);

  const newSettings = {
    serverUrl: serverUrlInput.value.trim(),
    whitelistedHosts: hosts.length > 0 ? hosts : ["*"],
    orbVisible: orbVisibleInput.checked,
    autoConnect: autoConnectInput.checked,
    handsFree: handsFreeInput.checked,
  };

  await chrome.storage.local.set(newSettings);

  // Notify background worker
  chrome.runtime.sendMessage({
    target: "background",
    type: "SAVE_SETTINGS",
    settings: newSettings,
  }).catch(() => {});

  // Show toast feedback
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
});
