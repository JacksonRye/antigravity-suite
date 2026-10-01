// Audio Manager for Antigravity Voice Butler (AudioWorklet + 24kHz PCM Playback + VAD)

export class AudioManager {
  constructor() {
    this.audioContext = null;
    this.mediaStream = null;
    this.audioWorkletNode = null;
    this.analyser = null;
    this.isRecording = false;
    this.nextStartTime = 0;
    this.scheduledSources = [];
    this.silenceTimer = null;
    this.silenceThreshold = 0.015;
    this.silenceTimeoutMs = 1500;
    this.onSpeechEndCallback = null;
  }

  async initializeAudio() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const workletUrl = chrome.runtime.getURL("pcm-processor.js");
      await this.audioContext.audioWorklet.addModule(workletUrl);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
    }
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  async startRecording(onAudioChunk, onVolumeChange) {
    await this.initializeAudio();
    this.stopAudioPlayback();

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      source.connect(this.analyser);

      this.audioWorkletNode = new AudioWorkletNode(this.audioContext, "pcm-processor");

      this.audioWorkletNode.port.onmessage = (event) => {
        if (!this.isRecording) return;
        const floatData = event.data;

        // Calculate RMS volume level
        let sum = 0;
        for (let i = 0; i < floatData.length; i++) {
          sum += floatData[i] * floatData[i];
        }
        const rms = Math.sqrt(sum / floatData.length);
        if (onVolumeChange) onVolumeChange(rms);

        // VAD silence tracking if callback registered
        if (this.onSpeechEndCallback) {
          if (rms < this.silenceThreshold) {
            if (!this.silenceTimer) {
              this.silenceTimer = setTimeout(() => {
                if (this.isRecording && this.onSpeechEndCallback) {
                  this.onSpeechEndCallback();
                }
              }, this.silenceTimeoutMs);
            }
          } else {
            if (this.silenceTimer) {
              clearTimeout(this.silenceTimer);
              this.silenceTimer = null;
            }
          }
        }

        // Downsample to 16kHz & convert to 16-bit PCM little-endian
        const downsampled = this.downsampleBuffer(
          floatData,
          this.audioContext.sampleRate,
          16000
        );
        const pcm16 = this.convertFloat32ToInt16(downsampled);
        onAudioChunk(pcm16);
      };

      source.connect(this.audioWorkletNode);

      // Connect silent gain node to prevent feedback loop through speakers
      const muteGain = this.audioContext.createGain();
      muteGain.gain.value = 0;
      this.audioWorkletNode.connect(muteGain);
      muteGain.connect(this.audioContext.destination);

      this.isRecording = true;
    } catch (err) {
      console.error("[AudioManager] Error accessing microphone:", err);
      throw err;
    }
  }

  setVADCallback(onSpeechEnd) {
    this.onSpeechEndCallback = onSpeechEnd;
  }

  stopRecording() {
    this.isRecording = false;
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioWorkletNode) {
      this.audioWorkletNode.disconnect();
      this.audioWorkletNode = null;
    }
  }

  playAudioChunk(arrayBuffer) {
    if (!this.audioContext) return;
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume();
    }

    const pcmData = new Int16Array(arrayBuffer);
    const float32Data = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      float32Data[i] = pcmData[i] / 32768.0;
    }

    const buffer = this.audioContext.createBuffer(1, float32Data.length, 24000);
    buffer.getChannelData(0).set(float32Data);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);

    const now = this.audioContext.currentTime;
    this.nextStartTime = Math.max(now, this.nextStartTime);
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;

    this.scheduledSources.push(source);
    source.onended = () => {
      const idx = this.scheduledSources.indexOf(source);
      if (idx > -1) this.scheduledSources.splice(idx, 1);
    };
  }

  stopAudioPlayback() {
    this.scheduledSources.forEach((s) => {
      try {
        s.stop();
      } catch (e) {}
    });
    this.scheduledSources = [];
    if (this.audioContext) {
      this.nextStartTime = this.audioContext.currentTime;
    }
  }

  downsampleBuffer(buffer, sampleRate, outSampleRate) {
    if (outSampleRate === sampleRate) return buffer;
    const ratio = sampleRate / outSampleRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0;
      let count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  convertFloat32ToInt16(buffer) {
    let l = buffer.length;
    const buf = new Int16Array(l);
    while (l--) {
      buf[l] = Math.min(1, Math.max(-1, buffer[l])) * 0x7fff;
    }
    return buf.buffer;
  }
}
