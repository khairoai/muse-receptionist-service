// The microphone as Muse Voice Transcribe takes it: 16 kHz, 16-bit mono PCM in 20 ms frames (320 samples). The
// browser's context runs at 44.1 or 48 kHz; each output sample averages the input samples it covers.
const OUT_RATE = 16000;
const FRAME = 320;

class MicFrames extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / OUT_RATE;
    this.pos = 0;
    this.sum = 0;
    this.count = 0;
    this.frame = new Int16Array(FRAME);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      this.sum += sample;
      this.count++;
      this.pos += 1;
      if (this.pos < this.step) continue;
      this.pos -= this.step;
      const v = Math.max(-1, Math.min(1, this.sum / this.count));
      this.sum = 0;
      this.count = 0;
      this.frame[this.filled++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.filled === FRAME) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new Int16Array(FRAME);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("mic-frames", MicFrames);
