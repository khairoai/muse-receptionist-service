import { basename } from "node:path";
import { Calendar } from "../calendar.ts";
import { createSparkClient } from "../meta/muse-spark.ts";
import { openTranscribeStream, type TranscribeStream } from "../meta/muse-transcribe.ts";
import { Receptionist, type TurnResult } from "../receptionist.ts";
import { loadWav16k, speechEndMs } from "../wav.ts";
import { metaApiKey, sparkModel } from "./env.ts";
import { printTurn } from "./print.ts";

/**
 * A phone call from WAV files: each file is one caller turn, played after the receptionist has answered the previous
 * one. Audio goes to Muse Voice Transcribe in 20 ms frames at real time, with silence in between, as a phone line
 * delivers it; Muse's end of turn hands the text to Muse Spark.
 *   pnpm call samples/bg-oil-change/*.wav
 */
const FRAME_MS = 20;
const FRAME_BYTES = (16000 * 2 * FRAME_MS) / 1000;
const SILENCE = Buffer.alloc(FRAME_BYTES);
/** Give up on a turn when no final text came this long after the audio ended. */
const TURN_TIMEOUT_MS = 8000;

/** Sends a frame every 20 ms of wall clock: the queued caller audio, else silence. */
class LinePump {
  private queue: Buffer[] = [];
  private sent = 0;
  private readonly started = performance.now();
  private readonly timer: NodeJS.Timeout;
  private drained: (() => void) | null = null;

  constructor(private readonly stt: TranscribeStream) {
    this.timer = setInterval(() => this.tick(), 5);
  }

  /** Queues the caller's audio and resolves when its last frame went out. */
  play(pcm: Buffer): Promise<void> {
    for (let off = 0; off < pcm.length; off += FRAME_BYTES) {
      const frame = pcm.subarray(off, off + FRAME_BYTES);
      this.queue.push(frame.length === FRAME_BYTES ? frame : Buffer.concat([frame, SILENCE.subarray(frame.length)]));
    }
    return new Promise((resolve) => (this.drained = resolve));
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private tick(): void {
    const due = Math.floor((performance.now() - this.started) / FRAME_MS);
    while (this.sent < due) {
      const frame = this.queue.shift();
      this.stt.write(frame ?? SILENCE);
      this.sent++;
      if (!frame || this.queue.length > 0) continue;
      this.drained?.();
      this.drained = null;
    }
  }
}

interface TurnTiming {
  file: string;
  heard: string;
  endOfTurnMs: number;
  reply: TurnResult;
}

async function main(): Promise<void> {
  const files = process.argv.slice(2).filter((a) => a !== "--");
  if (!files.length) {
    console.error("usage: pnpm call <turn1.wav> [turn2.wav …]   (e.g. pnpm call samples/bg-oil-change/*.wav)");
    process.exit(1);
  }
  const apiKey = metaApiKey();
  const calendar = new Calendar();
  const receptionist = new Receptionist(createSparkClient(apiKey), calendar, { model: sparkModel() });

  const opening = performance.now();
  const stt = await openTranscribeStream({ apiKey, languageBias: "Bulgarian", keywords: calendar.keyterms() });
  console.log(`\x1b[2mmuse-voice-transcribe: session open in ${Math.round(performance.now() - opening)} ms\x1b[0m`);
  stt.on("error", (err) => console.error(`stt error: ${err.message}`));
  const pump = new LinePump(stt);
  console.log(`  agent › ${receptionist.greeting}`);

  const turns: TurnTiming[] = [];
  for (const file of files.sort()) {
    const pcm = await loadWav16k(file);
    const speechEnd = speechEndMs(pcm);

    // Muse may end a turn in a pause and then hear more: the turn is every final until the audio has played and
    // the last final came after the caller's last word.
    const finals: string[] = [];
    let lastFinalAt = 0;
    let wordsPending = false;
    const onPartial = () => (wordsPending = true);
    const onFinal = ({ text }: { text: string }) => {
      if (text) finals.push(text);
      wordsPending = false;
      lastFinalAt = performance.now();
    };
    stt.on("partial", onPartial);
    stt.on("final", onFinal);

    const playStarted = performance.now();
    await pump.play(pcm);
    const lastWordAt = playStarted + speechEnd;
    await waitFor(() => finals.length > 0 && !wordsPending && lastFinalAt >= lastWordAt, TURN_TIMEOUT_MS);
    stt.off("partial", onPartial);
    stt.off("final", onFinal);

    const heard = finals.join(" ");
    const endOfTurnMs = Math.max(0, lastFinalAt - lastWordAt);
    console.log(`\ncaller › ${heard || "(no words)"}`);
    console.log(`\x1b[2m    muse-voice-transcribe: end of turn ${Math.round(endOfTurnMs)} ms after the last word (${basename(file)})\x1b[0m`);
    if (!heard) break;
    const reply = await receptionist.reply(heard);
    printTurn(reply);
    turns.push({ file, heard, endOfTurnMs, reply });
  }

  pump.stop();
  await stt.close();
  printSummary(turns);
}

function printSummary(turns: TurnTiming[]): void {
  console.log("\n| turn | end of turn (STT) | first token (LLM) | tool calls | reply done |");
  console.log("|---|---|---|---|---|");
  for (const [i, t] of turns.entries()) {
    const first = t.reply.rounds[0]?.firstTokenMs ?? null;
    const tools = t.reply.rounds.flatMap((r) => r.toolCalls.map((c) => c.call.name)).join(", ") || "–";
    const done = t.reply.rounds.reduce((n, r) => n + r.totalMs + r.toolCalls.reduce((m, c) => m + c.ms, 0), 0);
    console.log(`| ${i + 1} | ${Math.round(t.endOfTurnMs)} ms | ${first === null ? "–" : `${Math.round(first)} ms`} | ${tools} | ${Math.round(done)} ms |`);
  }
}

function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  return new Promise((resolve) => {
    const check = () => (cond() || performance.now() > deadline ? resolve() : setTimeout(check, 10));
    check();
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
