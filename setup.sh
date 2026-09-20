#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "  🚀 Antigravity Supercharged Suite - Remote Installer"
echo "=========================================================="

TARGET_DIR="$HOME/antigravity-suite"

if [ -d "$TARGET_DIR" ]; then
    echo "Updating existing installation in $TARGET_DIR..."
    cd "$TARGET_DIR"
    git pull origin main || true
else
    echo "Cloning Antigravity Suite to $TARGET_DIR..."
    git clone https://github.com/JacksonRye/antigravity-suite.git "$TARGET_DIR"
fi

cd "$TARGET_DIR"
chmod +x install.sh
./install.sh
