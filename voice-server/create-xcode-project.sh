#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$SCRIPT_DIR/chrome-extension"
OUT_DIR="$SCRIPT_DIR/safari-xcode-app"

echo "=================================================="
echo " Building Native Safari Web Extension for iOS/Mac "
echo "=================================================="

# Check if running on macOS with Xcode command line tools
if ! command -v xcrun &> /dev/null; then
    echo "Error: xcrun not found. Please run this script on your Mac with Xcode installed."
    exit 1
fi

mkdir -p "$OUT_DIR"

echo "Converting extension using Apple's official safari-web-extension-converter..."
xcrun safari-web-extension-converter "$EXT_DIR" \
    --project-location "$OUT_DIR" \
    --app-name "Antigravity Voice Butler" \
    --bundle-identifier "com.antigravity.voicebutler" \
    --swift \
    --rebuild-project \
    --no-prompt

echo ""
echo "✅ Xcode project generated successfully at:"
echo "$OUT_DIR/Antigravity Voice Butler"
echo ""
echo "Opening Xcode project..."
open "$OUT_DIR/Antigravity Voice Butler/Antigravity Voice Butler.xcodeproj"

echo ""
echo "Instructions to deploy to your iPad:"
echo "1. Connect your iPad to your Mac (via USB cable or Wi-Fi)."
echo "2. In Xcode's top destination menu, select your iPad."
echo "3. In Signing & Capabilities, select your Personal Team / Apple ID."
echo "4. Press the Run button (▶)."
echo "5. On your iPad, open Settings -> Safari -> Extensions -> enable 'Antigravity Voice Butler'."
echo "=================================================="
