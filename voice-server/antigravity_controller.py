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

    def find_cdp_ws_url(self, target_conv_id: str | None = None) -> str | None:
        """Discovers the active CDP Page WebSocket URL from Antigravity's logs or DevTools port."""
        log_paths = [
            os.path.expanduser("~/Library/Logs/Antigravity/language_server.log"),
            os.path.expanduser("~/.config/Antigravity/logs/language_server.log"),
        ]
        log_path = next((p for p in log_paths if os.path.exists(p)), None)
        
        ports_to_try = []
        if not log_path:
            port_file = os.path.expanduser("~/.config/Antigravity/DevToolsActivePort")
            if os.path.exists(port_file):
                try:
                    with open(port_file, "r") as f:
                        ports_to_try.append(int(f.readline().strip()))
                except Exception as e:
                    logger.warning(f"DevToolsActivePort read failed: {e}")
        else:
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

        # Try to find target matching target_conv_id first, then fallback to any page
        fallback_url = None
        for port in ports_to_try:
            try:
                req = urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=1)
                targets = json.loads(req.read().decode())
                for t in targets:
                    if t.get("type") == "page" and "webSocketDebuggerUrl" in t:
                        page_url = t.get("url", "")
                        if target_conv_id and target_conv_id in page_url:
                            logger.info(f"Found matching CDP target for conv {target_conv_id}: {page_url}")
                            return t["webSocketDebuggerUrl"]
                        if not fallback_url:
                            fallback_url = t["webSocketDebuggerUrl"]
            except Exception:
                continue

        if fallback_url:
            logger.info(f"Using fallback CDP target (no exact conv match for {target_conv_id})")
            return fallback_url

        return None

    async def write_to_chat(self, prompt: str, submit: bool = False, target_conv_id: str | None = None) -> dict:
        """
        Types the given prompt into Antigravity's chat input.
        If submit is True, automatically clicks the Send message button.
        """
        ws_url = self.find_cdp_ws_url(target_conv_id)
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
                    const el = document.querySelector('[data-lexical-editor="true"]') ||
                               document.querySelector('[contenteditable="true"][aria-label="Message input"]');
                    if (!el) return { found: false };
                    el.focus();
                    try {
                        const sel = window.getSelection();
                        const range = document.createRange();
                        range.selectNodeContents(el);
                        sel.removeAllRanges();
                        sel.addRange(range);
                        document.execCommand('delete', false, null);
                    } catch (_) {}
                    el.innerHTML = '';
                    el.innerText = '';
                    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
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
