import os
import json
import logging
import asyncio
import httpx
import websockets

logger = logging.getLogger("cdp_bridge")

class AntigravityCDPBridge:
    def __init__(self):
        self.port_path = os.path.expanduser("~/.config/Antigravity/DevToolsActivePort")
        self.cached_port = None
        self.cached_ws_url = None

    def get_devtools_port(self) -> int | None:
        """Read the active DevTools port from disk."""
        candidate_paths = [
            os.path.expanduser("~/.config/Antigravity/DevToolsActivePort"),
            os.path.expanduser("~/Library/Application Support/Antigravity/DevToolsActivePort"),
        ]
        for path in candidate_paths:
            if os.path.isfile(path):
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        lines = [line.strip() for line in f if line.strip()]
                    if lines:
                        port = int(lines[0])
                        self.cached_port = port
                        return port
                except Exception as e:
                    logger.warning(f"Error reading {path}: {e}")
        return self.cached_port

    async def get_active_page_target(self) -> dict | None:
        """Fetch list of CDP targets and find the active Antigravity IDE page."""
        port = self.get_devtools_port()
        if not port:
            logger.warning("No DevTools port found for Antigravity.")
            return None

        url = f"http://127.0.0.1:{port}/json/list"
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                res = await client.get(url)
                if res.status_code == 200:
                    targets = res.json()
                    # Find page targets (exclude background_page, service_worker)
                    for target in targets:
                        if target.get("type") == "page":
                            ws_url = target.get("webSocketDebuggerUrl")
                            if ws_url:
                                self.cached_ws_url = ws_url
                                return target
        except Exception as e:
            logger.warning(f"Error fetching CDP targets from {url}: {e}")
        return None

    async def get_active_conversation(self) -> dict:
        """Retrieve current conversation ID and title from Antigravity IDE via CDP."""
        target = await self.get_active_page_target()
        if not target or not target.get("webSocketDebuggerUrl"):
            return {"id": "", "title": "Unknown", "url": ""}

        ws_url = target["webSocketDebuggerUrl"]
        expr = """
            (() => {
                const match = window.location.pathname.match(/\\/c\\/([0-9a-f-]{36})/i) ||
                              window.location.hash.match(/\\/c\\/([0-9a-f-]{36})/i);
                const cid = match ? match[1] : '';
                let title = document.title ? document.title.replace(/\\s*-\\s*Antigravity\\s*$/i, '').trim() : '';
                return { id: cid, title: title, url: window.location.href };
            })()
        """
        try:
            async with websockets.connect(ws_url) as ws:
                msg = {
                    "id": 1,
                    "method": "Runtime.evaluate",
                    "params": {"expression": expr, "returnByValue": True}
                }
                await ws.send(json.dumps(msg))
                raw = await ws.recv()
                data = json.loads(raw)
                val = data.get("result", {}).get("result", {}).get("value", {})
                return val or {"id": "", "title": "Antigravity", "url": target.get("url", "")}
        except Exception as e:
            logger.error(f"Error getting active conversation via CDP: {e}")
            return {"id": "", "title": "Error", "url": ""}

    async def write_and_submit_prompt(self, prompt: str, submit: bool = True) -> dict:
        """Directly insert text into Antigravity Lexical editor and submit via CDP."""
        target = await self.get_active_page_target()
        if not target or not target.get("webSocketDebuggerUrl"):
            logger.error("No active page target available to write prompt.")
            return {"success": False, "error": "No active Antigravity page target"}

        ws_url = target["webSocketDebuggerUrl"]
        logger.info(f"Writing prompt via CDP to {ws_url} (submit={submit})")

        try:
            async with websockets.connect(ws_url) as ws:
                # 1. Focus editor and clear any leftover draft
                focus_script = """
                    (() => {
                        const el = document.querySelector('[data-lexical-editor="true"]') ||
                                   document.querySelector('div[contenteditable="true"]') ||
                                   document.querySelector('[contenteditable="true"]');
                        if (!el) return false;
                        el.focus();
                        try { el.click(); } catch (_) {}
                        const sel = window.getSelection();
                        const range = document.createRange();
                        range.selectNodeContents(el);
                        sel.removeAllRanges();
                        sel.addRange(range);
                        document.execCommand('delete', false, null);
                        return true;
                    })()
                """
                await ws.send(json.dumps({
                    "id": 10,
                    "method": "Runtime.evaluate",
                    "params": {"expression": focus_script, "returnByValue": True}
                }))
                res1 = json.loads(await ws.recv())
                focused = res1.get("result", {}).get("result", {}).get("value", False)
                if not focused:
                    logger.warning("Lexical editor element not found in Antigravity DOM.")
                    return {"success": False, "error": "Lexical editor element not found"}

                # 2. Insert text using native CDP Input.insertText
                await ws.send(json.dumps({
                    "id": 11,
                    "method": "Input.insertText",
                    "params": {"text": prompt}
                }))
                await ws.recv()

                # Dispatch synthetic change and input events to ensure state sync
                sync_script = """
                    (() => {
                        const el = document.querySelector('[data-lexical-editor="true"]') ||
                                   document.querySelector('div[contenteditable="true"]');
                        if (el) {
                            el.dispatchEvent(new Event('input', { bubbles: true }));
                            el.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    })()
                """
                await ws.send(json.dumps({
                    "id": 12,
                    "method": "Runtime.evaluate",
                    "params": {"expression": sync_script}
                }))
                await ws.recv()

                # 3. Submit if requested
                if submit:
                    await asyncio.sleep(0.15)
                    submit_script = """
                        (() => {
                            let btn = document.querySelector('button[aria-label="Send message"]') ||
                                      document.querySelector('button[aria-label="Send"]') ||
                                      document.querySelector('button[type="submit"]');
                            if (!btn) {
                                const el = document.querySelector('[data-lexical-editor="true"]');
                                let p = el ? el.parentElement : null;
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
                                return { submitted: true, method: 'button_click' };
                            }
                            return { submitted: false };
                        })()
                    """
                    await ws.send(json.dumps({
                        "id": 13,
                        "method": "Runtime.evaluate",
                        "params": {"expression": submit_script, "returnByValue": True}
                    }))
                    sub_res = json.loads(await ws.recv())
                    submitted = sub_res.get("result", {}).get("result", {}).get("value", {}).get("submitted", False)

                    # Fallback to native Enter key via CDP Input.dispatchKeyEvent
                    if not submitted:
                        await ws.send(json.dumps({
                            "id": 14,
                            "method": "Input.dispatchKeyEvent",
                            "params": {
                                "type": "keyDown",
                                "key": "Enter",
                                "code": "Enter",
                                "windowsVirtualKeyCode": 13,
                                "nativeVirtualKeyCode": 13,
                                "macCharCode": 13
                            }
                        }))
                        await ws.recv()
                        await ws.send(json.dumps({
                            "id": 15,
                            "method": "Input.dispatchKeyEvent",
                            "params": {
                                "type": "keyUp",
                                "key": "Enter",
                                "code": "Enter",
                                "windowsVirtualKeyCode": 13,
                                "nativeVirtualKeyCode": 13,
                                "macCharCode": 13
                            }
                        }))
                        await ws.recv()

                logger.info(f"Successfully typed and submitted prompt via CDP: {prompt[:30]}...")
                return {"success": True, "prompt": prompt, "submitted": submit}

        except Exception as e:
            logger.error(f"CDP write execution failed: {e}")
            return {"success": False, "error": str(e)}

    async def navigate_to_conversation(self, conversation_id: str) -> bool:
        """Navigate to a conversation inside Antigravity via CDP."""
        target = await self.get_active_page_target()
        if not target or not target.get("webSocketDebuggerUrl"):
            return False

        ws_url = target["webSocketDebuggerUrl"]
        expr = f"""
            (() => {{
                const row = document.querySelector('[data-cascade-id="{conversation_id}"], a[href*="{conversation_id}"]');
                if (row) {{
                    row.click();
                    return true;
                }}
                try {{
                    history.pushState(null, '', '/c/{conversation_id}');
                    window.dispatchEvent(new PopStateEvent('popstate'));
                    return true;
                }} catch (_) {{
                    window.location.href = '/c/{conversation_id}';
                    return true;
                }}
            }})()
        """
        try:
            async with websockets.connect(ws_url) as ws:
                await ws.send(json.dumps({
                    "id": 20,
                    "method": "Runtime.evaluate",
                    "params": {"expression": expr, "returnByValue": True}
                }))
                res = json.loads(await ws.recv())
                return res.get("result", {}).get("result", {}).get("value", False)
        except Exception as e:
            logger.error(f"CDP navigate execution failed: {e}")
            return False


# Global singleton instance
cdp_bridge = AntigravityCDPBridge()
