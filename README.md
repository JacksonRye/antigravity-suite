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
- Configures macOS auto-start for the voice service on login.
- Launches Antigravity with all models and live voice ready to use.
