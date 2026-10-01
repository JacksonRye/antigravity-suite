// Gemini Live WebSocket Client for Antigravity Remote Control Extension

export class GeminiLiveClient {
  constructor(options = {}) {
    this.serverUrl = options.serverUrl || "ws://localhost:8000/ws";
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectTimeout = null;

    // Callbacks
    this.onOpen = options.onOpen || (() => {});
    this.onClose = options.onClose || (() => {});
    this.onError = options.onError || (() => {});
    this.onAudioData = options.onAudioData || (() => {});
    this.onJsonMessage = options.onJsonMessage || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
  }

  setServerUrl(url) {
    this.serverUrl = url;
  }

  connect(conversationId = null) {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    let url = this.serverUrl;
    if (conversationId) {
      const sep = url.includes("?") ? "&" : "?";
      url = `${url}${sep}conversation_id=${encodeURIComponent(conversationId)}`;
    }

    this.onStatusChange("connecting");
    try {
      this.ws = new WebSocket(url);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.onStatusChange("connected");
        this.onOpen();
      };

      this.ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          this.onAudioData(event.data);
        } else if (typeof event.data === "string") {
          try {
            const data = JSON.parse(event.data);
            this.onJsonMessage(data);
          } catch (e) {
            console.error("[GeminiLiveClient] Failed to parse JSON message:", e);
          }
        }
      };

      this.ws.onclose = (event) => {
        this.isConnected = false;
        this.onStatusChange("disconnected");
        this.onClose(event);
      };

      this.ws.onerror = (err) => {
        this.isConnected = false;
        this.onStatusChange("error");
        this.onError(err);
      };
    } catch (err) {
      this.onStatusChange("error");
      this.onError(err);
    }
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.onStatusChange("disconnected");
  }

  sendAudio(pcmChunk) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(pcmChunk);
    }
  }

  sendText(text) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(text);
    }
  }

  setActiveConversation(conversationId, title = "") {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "set_active_conversation",
        conversation_id: conversationId,
        title: title,
      }));
    }
  }
}
