import { readFile } from "node:fs/promises";

/** A 16-bit PCM WAV as 16 kHz mono PCM, the format Muse Voice Transcribe takes raw. */
export async function loadWav16k(path: string): Promise<Buffer> {
  const buf = await readFile(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error(`${path}: not a RIFF/WAVE file`);
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let pcm: Buffer | undefined;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = buf.subarray(offset + 8, offset + 8 + size);
    if (id === "fmt ") {
      if (body.readUInt16LE(0) !== 1) throw new Error(`${path}: only PCM WAV is supported`);
      channels = body.readUInt16LE(2);
      sampleRate = body.readUInt32LE(4);
      bits = body.readUInt16LE(14);
    } else if (id === "data") {
      pcm = body;
    }
    offset += 8 + size + (size % 2);
  }
  if (!pcm || sampleRate === 0) throw new Error(`${path}: missing fmt or data chunk`);
  if (bits !== 16) throw new Error(`${path}: only 16-bit WAV is supported, got ${bits}-bit`);
  return resample(firstChannel(pcm, channels), sampleRate, 16000);
}

function firstChannel(pcm: Buffer, channels: number): Buffer {
  if (channels === 1) return pcm;
  const frames = pcm.length / (2 * channels);
  const out = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) out.writeInt16LE(pcm.readInt16LE(i * channels * 2), i * 2);
  return out;
}

/** Linear interpolation: plenty for speech recognition. */
function resample(pcm: Buffer, from: number, to: number): Buffer {
  if (from === to) return pcm;
  const inSamples = pcm.length / 2;
  const outSamples = Math.floor((inSamples * to) / from);
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const pos = (i * from) / to;
    const a = Math.floor(pos);
    const b = Math.min(a + 1, inSamples - 1);
    const t = pos - a;
    out.writeInt16LE(Math.round(pcm.readInt16LE(a * 2) * (1 - t) + pcm.readInt16LE(b * 2) * t), i * 2);
  }
  return out;
}

/** Offset (ms) where the speech in 16 kHz PCM ends: the last 20 ms frame louder than a quiet room. */
export function speechEndMs(pcm: Buffer, rmsThreshold = 500): number {
  const frameBytes = 640;
  let last = 0;
  for (let off = 0; off + frameBytes <= pcm.length; off += frameBytes) {
    let sum = 0;
    for (let i = off; i < off + frameBytes; i += 2) sum += pcm.readInt16LE(i) ** 2;
    if (Math.sqrt(sum / (frameBytes / 2)) > rmsThreshold) last = off + frameBytes;
  }
  return (last / 2 / 16000) * 1000;
}
