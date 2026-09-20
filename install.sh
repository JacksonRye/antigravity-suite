#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "  🚀 Installing Antigravity Custom Models & Live Voice"
echo "=========================================================="

APP_PATH="/Applications/Antigravity.app"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PATCH_DIR="$SCRIPT_DIR/patch"
VOICE_DIR="$SCRIPT_DIR/voice-server"

# 1. Verify Antigravity exists
if [ ! -d "$APP_PATH" ]; then
    echo "❌ Error: Antigravity.app not found at $APP_PATH."
    echo "Please download and install Google Antigravity first."
    exit 1
fi

# 2. Check Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "❌ Error: Node.js is required but not installed."
    echo "Install via Homebrew: brew install node"
    exit 1
fi

# 3. Check Python 3
if ! command -v python3 >/dev/null 2>&1; then
    echo "❌ Error: Python 3 is required but not installed."
    echo "Install via Homebrew: brew install python"
    exit 1
fi

# 4. Close running Antigravity instance
echo "[1/4] Closing running Antigravity instance..."
pkill -f "Antigravity.app" 2>/dev/null || true
sleep 1

# 5. Build and deploy patch into Antigravity
echo "[2/4] Building and deploying custom model & voice patch..."
cd "$PATCH_DIR"
if [ ! -d "node_modules" ]; then
    npm ci --ignore-scripts || npm install
fi
npm run build
bash deploy.sh --resources "$APP_PATH"

# 6. Set up and start Python Live Voice daemon
echo "[3/4] Setting up Python voice server..."
cd "$VOICE_DIR"
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
    .venv/bin/pip install --upgrade pip
    .venv/bin/pip install -r requirements.txt
    if [ -f "google_genai-2.14.0-py3-none-any.whl" ]; then
        .venv/bin/pip install google_genai-2.14.0-py3-none-any.whl --force-reinstall
    fi
fi

# 7. Configure Login Item / Startup
echo "[4/4] Starting voice backend and launching Antigravity..."
cat << 'LAUNCHER' > "$HOME/start_gemini_voice.sh"
#!/usr/bin/env bash
VOICE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/antigravity-suite/voice-server"
if [ ! -d "$VOICE_DIR" ]; then
    VOICE_DIR="$HOME/antigravity-unified/voice-server"
fi
if [ -d "$VOICE_DIR" ]; then
    cd "$VOICE_DIR"
    nohup .venv/bin/uvicorn main:app --port 8000 --host 0.0.0.0 > uvicorn.log 2>&1 &
fi
LAUNCHER
chmod +x "$HOME/start_gemini_voice.sh"

# Add to macOS login items
osascript -e 'tell application "System Events" to make login item at end with properties {path:"'"$HOME"'/start_gemini_voice.sh", hidden:true}' 2>/dev/null || true

# Start voice daemon now
lsof -ti :8000 | xargs kill -9 2>/dev/null || true
cd "$VOICE_DIR"
nohup .venv/bin/uvicorn main:app --port 8000 --host 0.0.0.0 > uvicorn.log 2>&1 &
sleep 2

# Launch Antigravity
open -a "$APP_PATH"

echo "=========================================================="
echo "  ✅ All Done! Custom models & Live Gemini voice are active!"
echo "=========================================================="
