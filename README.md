# Antigravity Supercharged Suite (Custom Models + Real-time Gemini Live Voice)

This repository packages the complete suite of superpowers for **Google Antigravity**:
1. **Custom Models Enabler** (`patch/`): Run OpenAI, Anthropic Claude, Together, Ollama, and Google AI Studio models natively inside Antigravity with auto-encrypted keys.
2. **Real-time Live Gemini Voice Butler** (`voice-server/`): Bi-directional live audio pair programmer with natural turn-taking, task execution tracking, and tool context retrieval.

---

## ⚡ 1-Command Installation (Fresh Laptop or Restore)

Open your macOS Terminal and run:

```bash
curl -fsSL https://raw.githubusercontent.com/JacksonRye/antigravity-suite/main/setup.sh | bash
```

*(Or clone manually and run `./install.sh`)*

```bash
git clone https://github.com/JacksonRye/antigravity-suite.git ~/antigravity-suite
cd ~/antigravity-suite
./install.sh
```

---

## What the 1-Command Setup Does Automatically
- Closes any running Antigravity instance.
- Compiles the TypeScript proxy and injects it into `/Applications/Antigravity.app`.
- Sets up the Python virtual environment and dependencies for the real-time voice engine.
- Sets up the native macOS `launchd` background daemon for the voice service on port 8000.
- Automatically syncs your Gemini API key from `~/.gemini/agent_platform.env`.
- Launches Antigravity with all models and live voice ready to use.

---

## 🔄 Updating Google Antigravity & Re-Applying Patches

When Google releases a new update to Antigravity:
1. Update or install the latest **Antigravity.app**.
2. Run the 1-command installer in your terminal:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/JacksonRye/antigravity-suite/main/setup.sh | bash
   ```
   *(Or if you already have the repository cloned: `cd ~/antigravity-suite && git pull && ./install.sh`)*

The script will automatically re-compile and inject all patches (custom models, memory manager, tab-switching continuation, tool announcements, and live voice butler) back into the fresh application bundle.
