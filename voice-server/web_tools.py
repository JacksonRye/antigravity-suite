"""
web_tools.py — Authoritative Google Search Grounding tool for Gemini Live Voice Butler.
Strictly uses Google Cloud Vertex AI / AI Platform Google Search Grounding per system directive.
"""

import asyncio
import json
import logging
import os
import urllib.request
import urllib.error
from typing import Dict, Any, List

logger = logging.getLogger("web_tools")

VERTEX_MODEL = "gemini-2.5-flash"
API_URL_TEMPLATE = "https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:generateContent?key={key}"

def _get_vertex_key() -> str:
    key = os.getenv("AIPLATFORM_API_KEY") or os.getenv("VERTEX_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not key:
        master_env = os.path.expanduser("~/.gemini/agent_platform.env")
        if os.path.exists(master_env):
            with open(master_env, "r") as f:
                for line in f:
                    if line.startswith("AIPLATFORM_API_KEY=") or line.startswith("GEMINI_API_KEY="):
                        key = line.split("=", 1)[1].strip().strip('"\'')
                        break
    return key or ""

async def search_web(query: str) -> Dict[str, Any]:
    """
    Executes a Google Search Grounding request via Google Cloud Vertex AI / AI Platform.
    Returns authoritative real-time web facts, citations, and summaries.
    """
    logger.info(f"Google Search Grounding requested for: '{query}'")
    key = _get_vertex_key()
    if not key:
        logger.error("No Vertex AI / Agent Platform key found.")
        return {"success": False, "error": "Missing Vertex AI Platform key", "summary": "", "sources": []}

    url = API_URL_TEMPLATE.format(model=VERTEX_MODEL, key=key)

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": f"Search Google and provide a concise, factual summary (2-3 sentences) answering: {query}"
                    }
                ]
            }
        ],
        "tools": [
            {
                "googleSearch": {}
            }
        ]
    }

    def _sync_post():
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        # Allow sufficient timeout for full Google Search Grounding crawl & synthesis
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))

    loop = asyncio.get_running_loop()
    try:
        data = await loop.run_in_executor(None, _sync_post)
        candidate = data.get("candidates", [{}])[0]
        text = ""
        parts = candidate.get("content", {}).get("parts", [])
        for part in parts:
            if "text" in part:
                text += part["text"]

        grounding = candidate.get("groundingMetadata", {})
        chunks = grounding.get("groundingChunks", [])
        sources = []
        for chunk in chunks:
            web = chunk.get("web", {})
            if web.get("uri") or web.get("title"):
                sources.append({
                    "title": web.get("title", ""),
                    "url": web.get("uri", "")
                })

        logger.info(f"Google Search Grounding succeeded for '{query}' ({len(sources)} sources)")
        results = [
            {"title": s.get("title", "Google Source"), "url": s.get("url", "#"), "snippet": text.strip()[:180]}
            for s in sources[:5]
        ]
        return {
            "success": True,
            "query": query,
            "summary": text.strip(),
            "sources": sources[:5],
            "results": results,
        }
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8")[:200]
        logger.error(f"Google Search Grounding HTTP {e.code}: {err_msg}")
        return {"success": False, "error": f"HTTP {e.code}: {err_msg}", "summary": "", "sources": []}
    except Exception as e:
        logger.error(f"Google Search Grounding error: {e}")
        return {"success": False, "error": str(e), "summary": "", "sources": []}
