import { EventEmitter } from "node:events";
import WebSocket from "ws";

/**
 * Meta's Muse Voice Transcribe over its realtime WebSocket (https://dev.meta.ai/docs/speech-to-text).
 *
 * ENDPOINTING mode: the model decides where each caller turn ends and sends `speechComplete` with the turn's final
 * text. Partials are cumulative per turn. There are no word timings, so a turn's "last word" is the stream time of the
 * last partial whose text changed.
 */
export interface MuseTranscribeOptions {
  apiKey: string;
  /** Default "muse-voice-transcribe-1.0". */
  model?: string;
  /** English name of the language to favour ("English"). Other languages still come back in their own words. */
  languageBias?: string;
  /** Words the business needs heard right: its services, staff, booking words. */
  keywords?: string[];
  /** Handshake acknowledgement deadline. Meta's handshake takes 0.8–1.6 s from Europe. */
  openTimeoutMs?: number;
}

export type TranscribeEvents = {
  speechStart: [{ streamMs: number }];
  /** The current turn's text so far (cumulative). */
  partial: [{ text: string; streamMs: number }];
  /** The turn ended: its final text, and the stream time its text last changed (≈ the last word). */
  final: [{ text: string; lastChangeMs: number }];
  error: [Error];
  close: [];
};

const URL_BASE = "wss://api.meta.ai/v1/asr/realtime";
/** Meta refuses the whole session (close 1008) for one keyword over 30 characters; any number of keywords is fine. */
const MAX_KEYWORD_CHARS = 30;
/** The only raw format we send: 16 kHz, 16-bit, mono PCM. */
export const SAMPLE_RATE = 16000;

export async function openTranscribeStream(opts: MuseTranscribeOptions): Promise<TranscribeStream> {
  const keywords = (opts.keywords ?? []).map((k) => k.trim()).filter((k) => k.length > 0 && k.length <= MAX_KEYWORD_CHARS);
  const handshake = {
    // The key travels in the first frame; the endpoint ignores an Authorization header.
    authorization: { accessToken: `Bearer ${opts.apiKey}` },
    audioEncoding: "PCM_16KHZ",
    model: opts.model ?? "muse-voice-transcribe-1.0",
    mode: "ENDPOINTING",
    partialMode: "CUMULATIVE",
    emitAudioProgress: false,
    ...(opts.languageBias ? { languageBias: [opts.languageBias] } : {}),
    ...(keywords.length ? { keywords } : {}),
  };
  const ws = new WebSocket(`${URL_BASE}?sessionId=${crypto.randomUUID()}`);
  const stream = new TranscribeStream(ws, JSON.stringify(handshake));
  await stream.waitForOpen(opts.openTimeoutMs ?? 5000);
  return stream;
}

export class TranscribeStream extends EventEmitter<TranscribeEvents> {
  private open = false;
  private closed = false;
  private closing = false;
  private openWaiter: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private partial = "";
  private partialChangedMs = 0;
  /** The server's error message, sent just before it closes: says why a handshake was refused. */
  private lastError = "";

  constructor(
    private readonly ws: WebSocket,
    handshake: string,
  ) {
    super();
    ws.on("open", () => ws.send(handshake));
    ws.on("message", (data, isBinary) => {
      if (!isBinary) this.handleMessage(data.toString());
    });
    ws.on("error", (err) => {
      this.openWaiter?.reject(err);
      if (this.listenerCount("error") > 0) this.emit("error", err);
    });
    ws.on("close", (code, reason) => {
      const wasOpen = this.open;
      this.open = false;
      this.closed = true;
      const why = this.lastError || reason.toString();
      this.openWaiter?.reject(new Error(`Muse Transcribe closed before the handshake (code ${code}${why ? `: ${why}` : ""})`));
      // A close we didn't ask for (1008 pacing, 1011 backend, session limit) ends the stream.
      if (wasOpen && !this.closing && code !== 1000) this.emit("error", new Error(`Muse Transcribe closed: ${code} ${why}`.trim()));
      this.emit("close");
    });
  }

  waitForOpen(timeoutMs: number): Promise<void> {
    if (this.open) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ws.terminate();
        reject(new Error(`Muse Transcribe handshake timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.openWaiter = {
        resolve: () => {
          clearTimeout(timer);
          this.openWaiter = null;
          resolve();
        },
        reject: (e) => {
          clearTimeout(timer);
          this.openWaiter = null;
          reject(e);
        },
      };
    });
  }

  /** 16 kHz 16-bit mono PCM, paced at real time (as a phone line delivers it). */
  write(pcm: Buffer): void {
    if (this.open && !this.closing && this.ws.readyState === WebSocket.OPEN) this.ws.send(pcm);
  }

  /** End of input: the server flushes what it has and closes with 1000. */
  async close(): Promise<void> {
    if (this.closed || this.closing) return;
    this.closing = true;
    const closed = new Promise<void>((resolve) => this.once("close", resolve));
    this.ws.send(JSON.stringify({ type: "endStream" }));
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 1000))]);
    if (!this.closed) this.ws.terminate();
  }

  private handleMessage(raw: string): void {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const at = typeof ev.audioProcessedMs === "number" ? ev.audioProcessedMs : 0;
    // The acknowledgement is the only frame without a type.
    if (ev.type === undefined) {
      if (typeof ev.sessionId === "string" && !this.open) {
        this.open = true;
        this.openWaiter?.resolve();
      }
      return;
    }
    switch (ev.type) {
      case "speechStart":
        this.partial = "";
        this.partialChangedMs = at;
        this.emit("speechStart", { streamMs: at });
        return;
      case "transcript": {
        const text = typeof ev.transcript === "string" ? ev.transcript.trim() : "";
        if (!text) return;
        if (text !== this.partial) {
          this.partial = text;
          this.partialChangedMs = at;
        }
        this.emit("partial", { text, streamMs: at });
        return;
      }
      case "speechComplete": {
        const text = typeof ev.transcript === "string" ? ev.transcript.trim() : "";
        this.partial = "";
        // An empty final happens: a short "yes" on a noisy line can come back with no words at all.
        this.emit("final", { text, lastChangeMs: this.partialChangedMs });
        return;
      }
      case "error":
        this.lastError = typeof ev.message === "string" ? ev.message : "error";
        if (this.open) this.emit("error", new Error(`Muse Transcribe: ${this.lastError}`));
        return;
      default:
        // speechEnd (the boundary; the text follows in speechComplete), audioProgress, future events.
        return;
    }
  }
}
