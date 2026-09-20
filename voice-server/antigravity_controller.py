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

    async def draft_to_chat(self, prompt: str) -> dict:
        """
        Drafts the given prompt into Antigravity's chat input without submitting.
        Clears any existing input first to prevent double-writing.
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

                logger.info(f"Drafted prompt in Antigravity: {prompt[:80]}...")
                return {
                    "success": True,
                    "action": "drafted",
                    "prompt": prompt
                }

        except Exception as e:
            logger.error(f"Error communicating via CDP in draft_to_chat: {e}")
            return {
                "success": False,
                "error": f"CDP communication failed: {str(e)}"
            }

    async def submit_chat(self) -> dict:
        """
        Clicks the 'Send message' button for whatever text is already in the chat input.
        Does NOT type, modify, or duplicate any text.
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
                # Check current input content and send button status
                check_and_click_js = """
                (() => {
                    const input = document.querySelector('[contenteditable="true"][aria-label="Message input"]');
                    const text = input ? (input.innerText || input.textContent || '').trim() : '';
                    const btn = document.querySelector('button[aria-label="Send message"]');
                    if (!input) {
                        return { status: "no_input_element" };
                    }
                    if (!text) {
                        return { status: "empty_input" };
                    }
                    if (!btn || btn.disabled) {
                        return { status: "send_disabled", text: text };
                    }
                    btn.click();
                    return { status: "submitted", text: text };
                })()
                """
                await ws.send(json.dumps({
                    "id": 1,
                    "method": "Runtime.evaluate",
                    "params": {"expression": check_and_click_js, "returnByValue": True}
                }))
                raw_res = await ws.recv()
                res = json.loads(raw_res)
                val = res.get("result", {}).get("result", {}).get("value", {})
                status = val.get("status", "unknown")
                text = val.get("text", "")

                if status == "submitted":
                    logger.info(f"Successfully submitted existing chat draft: {text[:80]}...")
                    return {
                        "success": True,
                        "action": "submitted",
                        "prompt": text
                    }
                elif status == "empty_input":
                    logger.warning("Attempted to submit, but chat input is completely empty.")
                    return {
                        "success": False,
                        "error": "The chat input box is completely empty. Please specify what you would like to draft first."
                    }
                elif status == "send_disabled":
                    logger.warning("Attempted to submit, but send button is disabled (agent may currently be generating).")
                    return {
                        "success": False,
                        "error": "The send button is currently disabled. The coding agent may already be running or generating a response."
                    }
                else:
                    return {
                        "success": False,
                        "error": f"Unable to submit chat: {status}"
                    }

        except Exception as e:
            logger.error(f"Error communicating via CDP in submit_chat: {e}")
            return {
                "success": False,
                "error": f"CDP communication failed: {str(e)}"
            }

    async def send_immediate_prompt(self, prompt: str) -> dict:
        """
        Types the given prompt and immediately clicks send in one combined operation.
        """
        draft_res = await self.draft_to_chat(prompt)
        if not draft_res.get("success"):
            return draft_res
        await asyncio.sleep(0.05)
        return await self.submit_chat()

    async def write_to_chat(self, prompt: str, submit: bool = False) -> dict:
        """
        Backward-compatible dispatcher:
        Calls send_immediate_prompt if submit=True, else draft_to_chat.
        """
        if submit:
            return await self.send_immediate_prompt(prompt)
        return await self.draft_to_chat(prompt)
