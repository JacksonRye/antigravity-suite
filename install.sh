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

# 7. Configure launchd LaunchAgent for Voice Server
echo "[4/4] Configuring background voice daemon and launching Antigravity..."
PLIST_PATH="$HOME/Library/LaunchAgents/com.antigravity.gemini-live-server.plist"

# Sync API key from master environment if available
if [ -f "$HOME/.gemini/agent_platform.env" ]; then
    echo "Found master agent_platform.env, syncing keys..."
    MASTER_KEY=$(grep "GEMINI_API_KEY=" "$HOME/.gemini/agent_platform.env" | cut -d '=' -f2- || true)
    if [ -n "$MASTER_KEY" ]; then
        sed -i '' "s|^GEMINI_API_KEY=.*|GEMINI_API_KEY=${MASTER_KEY}|" "$VOICE_DIR/.env" 2>/dev/null || true
    fi
fi

# Stop any running instances
launchctl bootout "gui/$(id -u)/com.antigravity.gemini-live-server" 2>/dev/null || true
lsof -ti :8000 | xargs kill -9 2>/dev/null || true

cat << PLIST > "$PLIST_PATH"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.antigravity.gemini-live-server</string>
    <key>ProgramArguments</key>
    <array>
        <string>$VOICE_DIR/.venv/bin/python3</string>
        <string>-m</string>
        <string>uvicorn</string>
        <string>main:app</string>
        <string>--host</string>
        <string>0.0.0.0</string>
        <string>--port</string>
        <string>8000</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$VOICE_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$VOICE_DIR/server.log</string>
    <key>StandardErrorPath</key>
    <string>$VOICE_DIR/server.error.log</string>
</dict>
</plist>
PLIST

# Load launchd service
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || launchctl load -w "$PLIST_PATH" 2>/dev/null || true
sleep 2

# Launch Antigravity
open -a "$APP_PATH"

echo "=========================================================="
echo "  ✅ All Done! Custom models & Live Gemini voice are active!"
echo "=========================================================="
