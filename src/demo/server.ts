import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { BUSINESS, Calendar } from "../calendar.ts";
import { metaApiKey, sparkModel } from "../cli/env.ts";
import { createSparkClient } from "../meta/muse-spark.ts";
import { openTranscribeStream, SAMPLE_RATE } from "../meta/muse-transcribe.ts";
import { Receptionist } from "../receptionist.ts";
import { speak, TTS_SAMPLE_RATE, voiceFromEnv } from "../tts/elevenlabs.ts";

/**
 * The khairo.ai/demo page, on this repo's pipeline: talk to Golden Gate Auto Care's receptionist from the browser.
 *   pnpm demo        then open http://localhost:3000
 * The browser sends the microphone as 16 kHz PCM over a WebSocket; here it streams to Muse Voice Transcribe, whose end
 * of turn hands the words to Muse Spark and the calendar tools, and each reply line is spoken by ElevenLabs (Meta has
 * no text-to-speech model), streamed back as PCM. Every line, tool call and timing goes to the page's log too.
 */
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = new URL("./public/", import.meta.url);
const FILES: Record<string, [string, string]> = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/demo.js": ["demo.js", "text/javascript; charset=utf-8"],
  "/mic-worklet.js": ["mic-worklet.js", "text/javascript; charset=utf-8"],
};
const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000;

const apiKey = metaApiKey();
const spark = createSparkClient(apiKey);
const voice = voiceFromEnv();
if (!voice) {
  console.error("Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env: the receptionist's voice (see .env.example).");
  process.exit(1);
}

const http = createServer(async (req, res) => {
  const file = FILES[new URL(req.url ?? "/", "http://localhost").pathname];
  if (!file) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": file[1], "cache-control": "no-store" }).end(await readFile(new URL(file[0], PUBLIC)));
});

const wss = new WebSocketServer({ server: http, path: "/call" });
wss.on("connection", (ws) => void call(ws));

/** One browser call: its own transcription stream, receptionist and calendar. */
async function call(ws: WebSocket): Promise<void> {
  const send = (msg: Record<string, unknown>) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  const calendar = new Calendar();
  const receptionist = new Receptionist(spark, calendar, { model: sparkModel() });
  const hungUp = new AbortController();

  // The receptionist's lines, spoken one after another: the line's text, its PCM as binary frames, then its end.
  let speaking = Promise.resolve();
  const say = (text: string) => {
    send({ type: "say", text });
    speaking = speaking.then(async () => {
      const started = performance.now();
      let firstByteMs: number | null = null;
      send({ type: "audioStart", sampleRate: TTS_SAMPLE_RATE });
      try {
        for await (const pcm of speak(voice!, text, hungUp.signal)) {
          firstByteMs ??= Math.round(performance.now() - started);
          if (ws.readyState === ws.OPEN) ws.send(pcm);
        }
      } catch (err) {
        if (!hungUp.signal.aborted) send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      }
      send({ type: "audioEnd", firstByteMs });
    });
  };

  const opening = performance.now();
  let stt: Awaited<ReturnType<typeof openTranscribeStream>>;
  try {
    stt = await openTranscribeStream({ apiKey, languageBias: "English", keywords: calendar.keyterms() });
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : String(err) });
    return ws.close();
  }
  if (ws.readyState !== ws.OPEN) return void stt.close();
  send({ type: "ready", business: BUSINESS.name, sttOpenMs: Math.round(performance.now() - opening) });
  say(receptionist.greeting);

  // Audio the browser has sent, in stream time: what Muse's lastChangeMs is measured in.
  let receivedBytes = 0;
  ws.on("message", (data, isBinary) => {
    if (!isBinary) return;
    const pcm = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    receivedBytes += pcm.length;
    stt.write(pcm);
  });

  // Muse can end a turn in a pause and then hear more: turns that end while a reply runs wait for it, then go as one.
  const waiting: string[] = [];
  let replying = false;
  async function answer(): Promise<void> {
    if (replying || !waiting.length) return;
    replying = true;
    const heard = waiting.splice(0).join(" ");
    try {
      const turn = await receptionist.reply(heard, {
        say,
        tool: (t) => send({ type: "tool", name: t.call.name, input: t.call.input, result: t.result, ms: Math.round(t.ms) }),
      });
      if (turn.switchedLanguage) send({ type: "language", language: turn.language });
      for (const r of turn.rounds) {
        const u = r.usage;
        send({ type: "spark", firstTokenMs: r.firstTokenMs === null ? null : Math.round(r.firstTokenMs), totalMs: Math.round(r.totalMs), inputTokens: u.inputTokens, cachedInputTokens: u.cachedInputTokens, outputTokens: u.outputTokens });
      }
    } catch (err) {
      send({ type: "error", message: `Muse Spark: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      replying = false;
      void answer();
    }
  }

  stt.on("partial", ({ text }) => send({ type: "partial", text }));
  stt.on("final", ({ text, lastChangeMs }) => {
    const endOfTurnMs = Math.max(0, Math.round(receivedBytes / BYTES_PER_MS - lastChangeMs));
    send({ type: "heard", text, endOfTurnMs });
    if (!text) return;
    waiting.push(text);
    void answer();
  });
  stt.on("error", (err) => {
    send({ type: "error", message: err.message });
    ws.close();
  });
  ws.on("close", () => {
    hungUp.abort();
    receptionist.hangUp();
    void stt.close();
  });
}

http.listen(PORT, () => {
  console.log(`${BUSINESS.name}'s receptionist on Muse Voice Transcribe + Muse Spark: http://localhost:${PORT}`);
});
