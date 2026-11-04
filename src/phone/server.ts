import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { WebSocketServer, type WebSocket } from "ws";
import { addDays, BUSINESS, Calendar, serviceById, weekdayName } from "../calendar.ts";
import { metaApiKey, sparkModel } from "../cli/env.ts";
import { createSparkClient } from "../meta/muse-spark.ts";
import { openTranscribeStream, SAMPLE_RATE, type TranscribeStream } from "../meta/muse-transcribe.ts";
import { GREETING, Receptionist } from "../receptionist.ts";
import { speak, voiceFromEnv } from "../tts/elevenlabs.ts";
import type { TurnListener, TurnResult } from "../turn.ts";
import { WaitlistRefill, type OfferCall } from "../waitlist.ts";

/**
 * Golden Gate Auto Care's receptionist on a real phone line: Telnyx Call Control and its bidirectional media stream
 * (L16 at 16 kHz both ways, as in Khairo's production voice service). Inbound calls get the receptionist; the waitlist
 * refill calls people back on the same line, from the same number.
 *   pnpm phone      (TELNYX_API_KEY, TELNYX_CONNECTION_ID, TELNYX_FROM_NUMBER and PUBLIC_URL in .env)
 *
 * The day is set for the waitlist demo: next Monday is fully booked, Tuesday has room. In the terminal, `cancel`
 * cancels Maria Lopez's Monday booking (the waitlist refill then calls back), `board` shows both days.
 *
 * To record just the call back: `pnpm phone --callback +359… [--name Vlad] [--in 5]` starts as if that caller had
 * already booked Tuesday and joined Monday's waitlist, then Maria cancels after --in seconds and the line calls them.
 */
const PORT = Number(process.env.PORT) || 8787;
const FRAME_BYTES = (SAMPLE_RATE * 2 * 20) / 1000;

const apiKey = metaApiKey();
const env = (name: string): string => {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`${name} is not set (see .env.example).`);
    process.exit(1);
  }
  return v;
};
const TELNYX_KEY = env("TELNYX_API_KEY");
const CONNECTION_ID = env("TELNYX_CONNECTION_ID");
const FROM = env("TELNYX_FROM_NUMBER");
const PUBLIC_URL = env("PUBLIC_URL").replace(/\/$/, "");
const voice = voiceFromEnv() ?? (console.error("Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env."), process.exit(1));
/** The call back has time: warmer and a little slower than the receptionist (10.5 s vs 9.5 s for one reply). */
const calmVoice = { ...voice, direction: process.env.ELEVENLABS_CALLBACK_DIRECTION?.trim() ?? "warm, unhurried phone pace" };
const spark = createSparkClient(apiKey);
const model = sparkModel();

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
/** Phone numbers on screen: the last three digits only (the terminal is on camera). */
const mask = (n: string) => `${n.slice(0, 4)}•••${n.slice(-3)}`;

// ---- The day ----

const calendar = new Calendar();
const refill = new WaitlistRefill(spark, calendar, { model });
const monday = nextWeekday(calendar.today().date, 1);
const tuesday = addDays(monday, 1);
const maria = fillDay(monday);
/** Bookings shown on the board besides those made on calls: Maria's, and a --callback caller's. */
const featured = new Set([maria.id]);

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const callbackTo = arg("callback");
if (callbackTo !== undefined && !/^\+\d{8,15}$/.test(callbackTo)) {
  console.error(`--callback needs a number in international format (+359…), got "${callbackTo}"`);
  process.exit(1);
}
if (callbackTo) seedCallback(callbackTo, arg("name") ?? "Thomas");

/** As if the caller had called: booked the first Tuesday time for an oil change, and joined Monday's waitlist to move. */
function seedCallback(phone: string, name: string): void {
  const oil = serviceById("oil_change")!;
  const time = calendar.freeStarts(oil, tuesday, "any")[0];
  const booking = time ? calendar.addBooking(name, oil.id, tuesday, time) : null;
  if (!booking) throw new Error(`no Tuesday time to seed ${name}'s booking`);
  featured.add(booking.id);
  calendar.joinWaitlist(name, oil, monday, "any", { phone, moveBookingId: booking.id });
}

function nextWeekday(today: string, weekday: number): string {
  for (let d = 1; ; d++) if (new Date(`${addDays(today, d)}T12:00:00Z`).getUTCDay() === weekday) return addDays(today, d);
}

/** Books the whole day: Maria's oil change mid-morning, then other customers in every gap. */
function fillDay(day: string) {
  const oil = serviceById("oil_change")!;
  const rotation = serviceById("tire_rotation")!;
  const start = calendar.freeStarts(oil, day, "any").find((t) => t >= "10:00") ?? calendar.freeStarts(oil, day, "any")[0];
  const booking = start ? calendar.addBooking("Maria Lopez", oil.id, day, start) : null;
  if (!booking) throw new Error(`no time on ${day} to seed the demo`);
  const others = ["Kevin Wu", "Priya Shah", "Daniel Kim", "Grace Okafor", "Luis Romero", "Hannah Fischer", "Omar Haddad", "Emily Chen"];
  for (let i = 0; ; i++) {
    const free = calendar.freeStarts(rotation, day, "any")[0];
    if (!free) break;
    calendar.addBooking(others[i % others.length]!, rotation.id, day, free);
  }
  return booking;
}

function printBoard(): void {
  const oil = serviceById("oil_change")!;
  for (const day of [monday, tuesday]) {
    const named = calendar.listBookings().filter((b) => b.date === day && (b.source !== "owner" || featured.has(b.id)));
    const free = calendar.freeStarts(oil, day, "any");
    console.log(bold(`  ${weekdayName(day)} ${day}`) + dim(`  oil change free at: ${free.length ? free.slice(0, 6).join(", ") + (free.length > 6 ? " …" : "") : "none, fully booked"}`));
    for (const b of named) console.log(dim(`    ${b.time}  ${b.service.name}, ${b.name}${b.source === "waitlist" ? "  ← moved here from the waitlist" : ""}`));
  }
  const waiting = calendar.waitlist().filter((e) => e.status === "waiting");
  if (waiting.length) console.log(dim(`  waitlist: ${waiting.map((e) => `${e.name} for ${weekdayName(e.date)}${e.moveBookingId ? " (move their booking)" : ""}`).join("; ")}`));
}

// ---- Telnyx ----

async function telnyx(path: string, body: Record<string, unknown>): Promise<{ data?: Record<string, unknown> }> {
  const res = await fetch(`https://api.telnyx.com/v2${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TELNYX_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Telnyx ${path} ${res.status}: ${text.slice(0, 300)}`);
  return text ? (JSON.parse(text) as { data?: Record<string, unknown> }) : {};
}

/** Production's stream settings: L16 16 kHz in and out, RTP mode, audio to the leg the stream is on. */
const streamParams = (line: string) => ({
  stream_url: `${PUBLIC_URL.replace(/^http/, "ws")}/telnyx/stream?line=${encodeURIComponent(line)}`,
  stream_track: "inbound_track",
  stream_codec: "L16",
  stream_bidirectional_mode: "rtp",
  stream_bidirectional_codec: "L16",
  stream_bidirectional_sampling_rate: SAMPLE_RATE,
  stream_bidirectional_target_legs: "self",
});

/** An offer call carries its opener: written by Muse Spark and voiced while the phone rings. */
type Line = { kind: "inbound"; from: string } | { kind: "offer"; call: OfferCall; done: () => void; opener: Promise<string[]> };
/** Our line id (the Telnyx call id for inbound calls) → what the call is. */
const lines = new Map<string, Line>();
/** Telnyx call id → our line id. */
const byCallId = new Map<string, string>();

async function onTelnyxEvent(event: { data?: { event_type?: string; payload?: Record<string, unknown> } }): Promise<void> {
  const type = event.data?.event_type;
  const p = event.data?.payload ?? {};
  const callId = String(p.call_control_id ?? "");
  switch (type) {
    case "call.initiated":
      if (p.direction !== "incoming") return;
      lines.set(callId, { kind: "inbound", from: String(p.from ?? "") });
      byCallId.set(callId, callId);
      console.log(bold(`\n☎  ${mask(String(p.from ?? ""))} is calling ${BUSINESS.name}`));
      await telnyx(`/calls/${encodeURIComponent(callId)}/actions/answer`, {});
      return;
    case "call.answered": {
      const line = lines.get(byCallId.get(callId) ?? "");
      if (line?.kind === "inbound") await telnyx(`/calls/${encodeURIComponent(callId)}/actions/streaming_start`, streamParams(callId));
      else if (line?.kind === "offer") console.log(dim("  (picked up)"));
      return;
    }
    case "call.hangup": {
      const id = byCallId.get(callId);
      const line = lines.get(id ?? "");
      byCallId.delete(callId);
      if (id) lines.delete(id);
      console.log(dim(`  (call ended: ${String(p.hangup_cause ?? "hangup")})`));
      if (line?.kind === "offer") line.done();
      return;
    }
  }
}

// ---- One call: Muse Voice Transcribe in, the agent, ElevenLabs out ----

/** Lines every call says, prepared as audio at start, so a call opens without waiting for the voice. */
const clips = new Map<string, Buffer>();
async function prepareClip(text: string, v = voice): Promise<void> {
  const parts: Buffer[] = [];
  for await (const pcm of speak(v, text, undefined, SAMPLE_RATE)) parts.push(pcm);
  clips.set(text, Buffer.concat(parts));
}

interface Agent {
  reply(text: string, listener: TurnListener): Promise<TurnResult>;
}

/** Loud enough to be speech on a phone line (16-bit RMS), and how long they must stop before the opener plays. */
const SPEECH_RMS = 600;
const HELLO_QUIET_MS = 300;
/** A callback's opener plays this long after pickup if they say nothing; once they talk, it waits for them to stop
 *  (at most OPENER_CAP_MS, so a line that never goes quiet still hears the offer). */
const OPENER_SILENT_WAIT_MS = 1500;
const OPENER_CAP_MS = 5000;


async function onStream(ws: WebSocket, lineId: string): Promise<void> {
  const line = lines.get(lineId);
  if (!line) return void ws.close();
  const start = await new Promise<{ call_control_id: string; media_format?: { encoding?: string; sample_rate?: number } } | null>((resolve) => {
    ws.on("message", function first(data) {
      const msg = JSON.parse(data.toString()) as { event?: string; start?: { call_control_id: string } };
      if (msg.event !== "start") return;
      ws.off("message", first);
      resolve(msg.start ?? null);
    });
    ws.on("close", () => resolve(null));
  });
  if (!start) return;
  const callId = start.call_control_id;
  const inRate = start.media_format?.sample_rate ?? SAMPLE_RATE;
  const pickedUp = performance.now();

  const receptionist = line.kind === "inbound" ? new Receptionist(spark, calendar, { model, callerPhone: line.from }) : null;
  const agent: Agent = receptionist ?? (line as Extract<Line, { kind: "offer" }>).call;
  const hungUp = new AbortController();
  const lineVoice = line.kind === "offer" ? calmVoice : voice;

  // The agent's lines, one after another, as 20 ms frames; playEnd estimates when the caller has heard the last one.
  let speaking = Promise.resolve();
  let playEnd = 0;
  const say = (text: string) => {
    console.log(`  agent › ${text}`);
    speaking = speaking.then(async () => {
      let carry = Buffer.alloc(0);
      let bytes = 0;
      const send = (frame: Buffer) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ event: "media", media: { payload: frame.toString("base64") } }));
      try {
        const clip = clips.get(text);
        for await (const pcm of clip ? [clip] : speak(lineVoice, text, hungUp.signal, SAMPLE_RATE)) {
          let buf = Buffer.concat([carry, pcm]);
          for (; buf.length >= FRAME_BYTES; buf = buf.subarray(FRAME_BYTES)) send(buf.subarray(0, FRAME_BYTES));
          carry = buf;
          bytes += pcm.length;
        }
        if (carry.length) send(Buffer.concat([carry, Buffer.alloc(FRAME_BYTES - carry.length)]));
      } catch (err) {
        if (!hungUp.signal.aborted) console.error(`  voice error: ${err instanceof Error ? err.message : String(err)}`);
      }
      playEnd = Math.max(playEnd, performance.now()) + (bytes / (SAMPLE_RATE * 2)) * 1000;
    });
  };

  // Muse Voice Transcribe connects while the call already runs (0.8–2 s from Europe): the caller's audio waits for it.
  let stt: TranscribeStream | null = null;
  const early: Buffer[] = [];
  // Is the person talking? From the audio itself, before any transcript: when they stop, the opener plays.
  let spoke = false;
  let speechMs = 0;
  let quietMs = 0;
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as { event?: string; media?: { payload?: string } };
    if (msg.event !== "media" || !msg.media?.payload) return;
    const raw = Buffer.from(msg.media.payload, "base64");
    const pcm = inRate === SAMPLE_RATE ? raw : upsample(raw, SAMPLE_RATE / inRate);
    if (stt) stt.write(pcm);
    else early.push(pcm);
    const ms = (pcm.length / (SAMPLE_RATE * 2)) * 1000;
    if (rms(pcm) > SPEECH_RMS) {
      speechMs += ms;
      quietMs = 0;
      if (speechMs >= 80) spoke = true;
    } else quietMs += ms;
  });

  // Muse can end a turn in a pause and then hear more: turns that end while a reply runs wait for it, then go as one.
  const waiting: string[] = [];
  let replying = false;
  // A callback's "Hello?" is answered by the opener: what Muse heard before the opener has played out is that hello.
  let openerUntil = line.kind === "offer" ? Infinity : 0;
  async function answer(): Promise<void> {
    if (replying || !waiting.length) return;
    replying = true;
    const heard = waiting.splice(0).join(" ");
    try {
      const turn = await agent.reply(heard, {
        say,
        tool: (t) => console.log(dim(`  ⚙ ${t.call.name}(${JSON.stringify(t.call.input)}) → ${String(t.result.status)}`)),
      });
      const first = turn.rounds[0]?.firstTokenMs;
      console.log(dim(`    muse-spark: first token ${first == null ? "–" : Math.round(first)} ms`));
      if (line!.kind === "offer" && line!.call.outcome) hangUpAfterSpeech();
    } catch (err) {
      console.error(`  muse-spark: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      replying = false;
      void answer();
    }
  }
  // The callback is over once the offer is settled and its last line has been heard.
  function hangUpAfterSpeech(): void {
    void speaking.then(() => setTimeout(() => void telnyx(`/calls/${encodeURIComponent(callId)}/actions/hangup`, {}).catch(() => {}), Math.max(0, playEnd - performance.now()) + 1200));
  }

  openTranscribeStream({ apiKey, languageBias: "English", keywords: calendar.keyterms() })
    .then((s) => {
      if (hungUp.signal.aborted) return void s.close();
      stt = s;
      for (const pcm of early.splice(0)) s.write(pcm);
      console.log(dim(`    muse-voice-transcribe: connected ${Math.round(performance.now() - pickedUp)} ms after pickup`));
      s.on("final", ({ text }) => {
        if (!text) return;
        if (performance.now() < openerUntil) return console.log(dim(`caller › ${text}   (their hello: the opener answers it)`));
        console.log(`caller › ${text}`);
        waiting.push(text);
        void answer();
      });
      s.on("error", (err) => console.error(`  muse-voice-transcribe: ${err.message}`));
    })
    .catch((err: unknown) => {
      console.error(`  muse-voice-transcribe: ${err instanceof Error ? err.message : String(err)}`);
      void telnyx(`/calls/${encodeURIComponent(callId)}/actions/hangup`, {}).catch(() => {});
    });

  if (receptionist) say(receptionist.greeting);
  else {
    // The opener was written and voiced while it rang: it plays once they've said hello (or after a moment's silence).
    const opener = await (line as Extract<Line, { kind: "offer" }>).opener;
    await new Promise<void>((resolve) => {
      const tick = setInterval(() => {
        const waited = performance.now() - pickedUp;
        const go = spoke ? quietMs >= HELLO_QUIET_MS || waited >= OPENER_CAP_MS : waited >= OPENER_SILENT_WAIT_MS;
        if (go || hungUp.signal.aborted) {
          clearInterval(tick);
          resolve();
        }
      }, 10);
    });
    const openerAt = performance.now();
    const after = Math.round(openerAt - pickedUp);
    console.log(dim(`    opener starts ${spoke && quietMs >= HELLO_QUIET_MS ? `${Math.round(quietMs)} ms after they stopped talking` : spoke ? `${after} ms after pickup (they kept talking)` : `${after} ms after pickup (they said nothing)`}, prepared while ringing`));
    for (const text of opener) say(text);
    await speaking;
    openerUntil = playEnd - 300;
  }

  ws.on("close", () => {
    hungUp.abort();
    receptionist?.hangUp();
    void stt?.close();
  });
}

function rms(pcm: Buffer): number {
  let sum = 0;
  const n = pcm.length >> 1;
  for (let i = 0; i < n; i++) {
    const v = pcm.readInt16LE(i * 2);
    sum += v * v;
  }
  return n ? Math.sqrt(sum / n) : 0;
}

/** 8 kHz PCM to 16 kHz, by linear interpolation, should a line deliver 8 kHz. */
function upsample(pcm: Buffer, factor: number): Buffer {
  const n = pcm.length / 2;
  const out = Buffer.alloc(n * factor * 2);
  for (let i = 0; i < n; i++) {
    const a = pcm.readInt16LE(i * 2);
    const b = i + 1 < n ? pcm.readInt16LE((i + 1) * 2) : a;
    for (let k = 0; k < factor; k++) out.writeInt16LE(Math.round(a + ((b - a) * k) / factor), (i * factor + k) * 2);
  }
  return out;
}

// ---- The waitlist calls back ----

let refilling = false;
let offers = 0;
calendar.onFreed(() => setTimeout(() => void runRefill(), 0));

async function runRefill(): Promise<void> {
  if (refilling) return;
  refilling = true;
  try {
    for (const r of await refill.refill(dial)) {
      if (!r.calls.length) continue;
      console.log(bold(r.booking ? `\n  owner › ${r.slot.cancelled.name} cancelled ${weekdayName(r.slot.date)} ${r.slot.time}; Khairo gave it to ${r.booking.name} from the waitlist.` : `\n  owner › ${weekdayName(r.slot.date)} ${r.slot.time} wasn't taken from the waitlist; it's open again.`));
      printBoard();
    }
  } catch (err) {
    console.error(`waitlist refill: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    refilling = false;
    if (refill.pending.length) void runRefill();
  }
}

/** While the phone rings: the greeting ("…Is this Thomas?") is voiced, so it plays the moment they've said hello. */
async function prepareOpener(call: OfferCall): Promise<string[]> {
  const started = performance.now();
  try {
    await prepareClip(call.greeting, calmVoice);
  } catch (err) {
    console.error(`  opener: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log(dim(`    opener ready in ${Math.round(performance.now() - started)} ms, while it rings`));
  return [call.greeting];
}

function dial(call: OfferCall): Promise<void> {
  const to = call.offer.entry.phone;
  if (!to) {
    console.log(dim(`  ${call.offer.entry.name} has no number to call back; skipped`));
    return Promise.resolve();
  }
  const lineId = `offer-${++offers}`;
  return new Promise((resolve) => {
    lines.set(lineId, { kind: "offer", call, done: resolve, opener: prepareOpener(call) });
    console.log(bold(`\n☎  Khairo calls ${call.offer.entry.name} back at ${mask(to)}: ${weekdayName(call.offer.slot.date)} ${call.offer.slot.time} just opened`));
    telnyx("/calls", { connection_id: CONNECTION_ID, to, from: FROM, timeout_secs: 40, ...streamParams(lineId) })
      .then((r) => byCallId.set(String(r.data?.call_control_id ?? ""), lineId))
      .catch((err: unknown) => {
        console.error(`  dial failed: ${err instanceof Error ? err.message : String(err)}`);
        lines.delete(lineId);
        resolve();
      });
  });
}

// ---- Server and terminal ----

const http = createServer((req, res) => {
  if (req.method === "POST" && req.url?.startsWith("/telnyx/webhook")) {
    let body = "";
    req.on("data", (c: Buffer) => (body += c));
    req.on("end", () => {
      res.writeHead(200).end();
      try {
        void onTelnyxEvent(JSON.parse(body)).catch((err: unknown) => console.error(`telnyx event: ${err instanceof Error ? err.message : String(err)}`));
      } catch {
        /* not JSON: ignored */
      }
    });
    return;
  }
  res.writeHead(req.url === "/" ? 200 : 404).end(req.url === "/" ? `${BUSINESS.name} phone line\n` : undefined);
});
const wss = new WebSocketServer({ server: http, path: "/telnyx/stream" });
wss.on("connection", (ws, req) => void onStream(ws, new URL(req.url ?? "", "http://x").searchParams.get("line") ?? ""));

prepareClip(GREETING).catch((err: unknown) => console.error(`greeting clip: ${err instanceof Error ? err.message : String(err)}`));
http.listen(PORT, () => {
  console.log(bold(`${BUSINESS.name} on ${FROM}: Muse Voice Transcribe + Muse Spark, via ${PUBLIC_URL}`));
  printBoard();
  console.log(dim("\n  commands: cancel (Maria Lopez cancels her Monday booking), board"));
  if (!callbackTo) return;
  const seconds = Number(arg("in") ?? 5);
  console.log(dim(`\n  Maria Lopez cancels in ${seconds} s; then Khairo calls ${mask(callbackTo)} back`));
  setTimeout(cancelMaria, seconds * 1000);
});

function cancelMaria(): void {
  const b = calendar.booking(maria.id);
  if (!b) return console.log(dim("  Maria's Monday booking is already cancelled"));
  calendar.cancel(b.id);
  console.log(bold(`\n  ✕ Maria Lopez cancelled her ${b.service.name.toLowerCase()} on ${weekdayName(b.date)} at ${b.time}: held for the waitlist`));
}

createInterface({ input: process.stdin }).on("line", (input) => {
  const cmd = input.trim();
  if (cmd === "board") return printBoard();
  if (cmd === "cancel") cancelMaria();
});
