"""
memory_manager.py — Long-term persistent memory management for Gemini Live Voice Butler.
Stores and updates developer preferences and facts in ~/.gemini/voice_butler_memory.md.
"""

import os
import re
import logging
from typing import Dict, Any

logger = logging.getLogger("memory_manager")

MEMORY_FILE_PATH = os.path.expanduser("~/.gemini/voice_butler_memory.md")

def load_memory() -> str:
    """
    Loads developer memory profile from disk.
    If file doesn't exist, returns empty string.
    """
    if not os.path.exists(MEMORY_FILE_PATH):
        return ""
    try:
        with open(MEMORY_FILE_PATH, "r", encoding="utf-8") as f:
            content = f.read().strip()
            return content
    except Exception as e:
        logger.error(f"Error loading memory profile: {e}")
        return ""

async def remember_fact(category: str, fact: str) -> Dict[str, Any]:
    """
    Persists a new fact or preference about the developer into ~/.gemini/voice_butler_memory.md.
    
    Args:
        category: Section heading, e.g. 'Developer Profile & Cognitive Style', 
                  'Workflow Directives', 'Technical Environment & Architecture', or 'Project & Domain Knowledge'.
        fact: The concise fact, rule, or preference to record.
    """
    logger.info(f"remember_fact called: category='{category}', fact='{fact}'")
    try:
        content = load_memory()
        clean_fact = fact.strip()
        if not clean_fact.startswith("- "):
            clean_fact = f"- {clean_fact}"

        # Normalize category
        cat_header = f"## {category.strip('# ')}"
        
        if cat_header.lower() in content.lower():
            # Find the section and append
            lines = content.splitlines()
            new_lines = []
            found = False
            inserted = False
            for line in lines:
                if line.strip().lower() == cat_header.lower():
                    found = True
                    new_lines.append(line)
                    continue
                if found and not inserted and (line.startswith("## ") or line == lines[-1]):
                    if line.startswith("## "):
                        new_lines.append(clean_fact)
                        new_lines.append("")
                        new_lines.append(line)
                        inserted = True
                        continue
                new_lines.append(line)
            
            if not inserted:
                new_lines.append(clean_fact)
            
            updated_content = "\n".join(new_lines).strip() + "\n"
        else:
            # Append new category section at bottom
            updated_content = content.rstrip() + f"\n\n{cat_header}\n{clean_fact}\n"

        with open(MEMORY_FILE_PATH, "w", encoding="utf-8") as f:
            f.write(updated_content)

        logger.info(f"Memory updated successfully under category: {category}")
        return {
            "success": True,
            "category": category,
            "fact_recorded": clean_fact,
            "message": f"Successfully remembered: {clean_fact}"
        }
    except Exception as e:
        logger.error(f"Failed to record memory: {e}")
        return {
            "success": False,
            "error": str(e)
        }
