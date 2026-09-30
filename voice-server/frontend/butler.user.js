// ==UserScript==
// @name         Antigravity Voice Butler (Gemini Live)
// @namespace    https://butler.retake.cloud/
// @version      99.9.9
// @description  Zero-maintenance auto-updating Voice Butler
// @match        *://*/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(async () => {
  if (window.__antigravityButlerLoaded) return;
  window.__antigravityButlerLoaded = true;

  try {
    const res = await fetch("https://butler.retake.cloud/butler.core.js?t=" + Date.now(), {
      cache: "no-store",
    });
    if (!res.ok) throw new Error("Failed to load core: " + res.status);
    const code = await res.text();
    (new Function(code))();
  } catch (err) {
    console.error("[Antigravity Butler Auto-Loader]", err);
  }
})();
