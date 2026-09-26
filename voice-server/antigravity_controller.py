import asyncio
import json
import logging
import os
import re
import urllib.request
import websockets

logger = logging.getLogger(__name__)

class AntigravityChatController:
    """Automates typing and sending messages into Antigravity's on-screen chat box via CDP."""

    def __init__(self):
        self.cached_ws_url = None

    def find_cdp_ws_url(self) -> str | None:
        """Discovers the active CDP Page WebSocket URL from Antigravity's language server logs."""
        log_path = os.path.expanduser("~/Library/Logs/Antigravity/language_server.log")
        if not os.path.exists(log_path):
            logger.warning("Antigravity language_server.log not found.")
            return None

        ports_to_try = []
        try:
            with open(log_path, "r", errors="ignore") as f:
                lines = f.readlines()
            for line in reversed(lines):
                m = re.search(r"ws://127.0.0.1:(\d+)/devtools/browser/([a-zA-Z0-9\-]+)", line)
                if m:
                    port = m.group(1)
                    if port not in ports_to_try:
                        ports_to_try.append(port)
                    if len(ports_to_try) >= 3:
                        break
        except Exception as e:
            logger.error(f"Error reading language_server.log: {e}")

        for port in ports_to_try:
            try:
                req = urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=1)
                targets = json.loads(req.read().decode())
                for t in targets:
                    if t.get("type") == "page" and "webSocketDebuggerUrl" in t:
                        return t["webSocketDebuggerUrl"]
            except Exception:
                continue

        return None

    async def write_to_chat(self, prompt: str, submit: bool = False) -> dict:
        """
        Types the given prompt into Antigravity's chat input.
        If submit is True, automatically clicks the Send message button.
        """
        ws_url = self.find_cdp_ws_url()
        if not ws_url:
            logger.error("Could not locate active Antigravity DevTools window.")
            return {
                "success": False,
                "error": "Antigravity editor window not found. Ensure Antigravity is running."
            }

        try:
            async with websockets.connect(ws_url) as ws:
                # 1. Clear previous text and focus the input element
                prep_js = """
                (() => {
                    const el = document.querySelector('[contenteditable="true"][aria-label="Message input"]');
                    if (!el) return { found: false };
                    el.focus();
                    document.execCommand('selectAll', false, null);
                    document.execCommand('delete', false, null);
                    return { found: true };
                })()
                """
                await ws.send(json.dumps({
                    "id": 1,
                    "method": "Runtime.evaluate",
                    "params": {"expression": prep_js, "returnByValue": True}
                }))
                raw_res1 = await ws.recv()
                res1 = json.loads(raw_res1)
                found = res1.get("result", {}).get("result", {}).get("value", {}).get("found", False)
                if not found:
                    return {
                        "success": False,
                        "error": "Chat message input element not found in Antigravity window."
                    }

                # 2. Insert new prompt text via CDP Input.insertText
                await ws.send(json.dumps({
                    "id": 2,
                    "method": "Input.insertText",
                    "params": {"text": prompt}
                }))
                await ws.recv()

                # 3. If submit requested, click the 'Send message' button
                if submit:
                    await asyncio.sleep(0.05)
                    submit_js = """
                    (() => {
                        const btn = document.querySelector('button[aria-label="Send message"]');
                        if (btn && !btn.disabled) {
                            btn.click();
                            return { clicked: true };
                        }
                        return { clicked: false, disabled: btn ? btn.disabled : true };
                    })()
                    """
                    await ws.send(json.dumps({
                        "id": 3,
                        "method": "Runtime.evaluate",
                        "params": {"expression": submit_js, "returnByValue": True}
                    }))
                    raw_res3 = await ws.recv()
                    res3 = json.loads(raw_res3)
                    clicked = res3.get("result", {}).get("result", {}).get("value", {}).get("clicked", False)
                    logger.info(f"Submitted prompt to Antigravity (clicked={clicked}): {prompt[:80]}...")
                    return {
                        "success": True,
                        "action": "submitted" if clicked else "drafted_send_disabled",
                        "prompt": prompt
                    }

                logger.info(f"Drafted prompt in Antigravity: {prompt[:80]}...")
                return {
                    "success": True,
                    "action": "drafted",
                    "prompt": prompt
                }

        except Exception as e:
            logger.error(f"Error communicating via CDP: {e}")
            return {
                "success": False,
                "error": f"CDP communication failed: {str(e)}"
            }
