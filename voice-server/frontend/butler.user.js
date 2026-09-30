// ==UserScript==
// @name         Antigravity Voice Butler (Gemini Live)
// @namespace    https://butler.retake.cloud/
// @version      99.9.9
// @description  Zero-maintenance auto-updating Voice Butler
// @match        *://*/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(() => {
  const old = document.getElementById("ag-butler-core-script");
  if (old) old.remove();
  const s = document.createElement("script");
  s.id = "ag-butler-core-script";
  s.src = "https://butler.retake.cloud/butler.core.js?t=" + Date.now();
  document.head.appendChild(s);
})();
