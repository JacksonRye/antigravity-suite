# Antigravity Voice Butler - Chrome Extension

Chrome Extension (Manifest V3) that provides a real-time **Gemini Live Voice Butler** companion directly inside your browser while connected to **Antigravity Remote Control** on your VPS.

## Features

- **In-Page Floating Voice Orb**: Sleek, draggable glassmorphism orb injected directly into your Antigravity remote control web tabs. Visual aura pulses with microphone volume and Butler speech.
- **Chrome Side Panel**: Docked companion side panel displaying real-time speech transcription, tool call events, and controls.
- **Push-to-Talk & Hands-Free VAD**: Click or hold to talk, or toggle Hands-Free continuous conversation with silence detection.
- **Antigravity Remote Input Automation**: Automatically writes and submits prompts into Antigravity's chat input when requested via voice (`write_to_chat`).
- **Seamless WebSocket Relay**: Streams 16kHz PCM audio to your Gemini Live server and receives 24kHz audio in real time.

## Installation in Chrome

1. Open Google Chrome and navigate to:
   ```
   chrome://extensions
   ```
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** in the top-left toolbar.
4. Select the folder:
   ```
   /Users/gameboy/Documents/Dev Apps/Spokenly Bridge/chrome-extension
   ```
5. The **Antigravity Voice Butler** extension is now installed!

## Connecting to Your VPS

1. Right-click the extension icon in your Chrome toolbar and choose **Options** (or click the gear icon in the side panel).
2. Set the **Gemini Live WebSocket Relay URL**:
   - For local development: `ws://localhost:8000/ws`
   - For your VPS: `ws://<YOUR-VPS-IP>:8000/ws` (or `wss://...` if SSL is configured)
3. Add your VPS domain or IP to the **Target Domains / Hosts** list (or enter `*` to allow everywhere).
4. Click **Save Settings**.

## Usage

1. Open your Antigravity Remote Web interface (or test with `test.html`).
2. You will see the floating voice orb in the bottom-right corner.
3. Click the orb to speak, or click the extension toolbar icon to open the **Side Panel**.
