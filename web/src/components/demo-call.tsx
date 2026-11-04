"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Phone, PhoneOff } from "lucide-react";
import { DEMO_PHONE, DEMO_PHONE_LABEL } from "@/components/content/demo";
import type { Live } from "@/components/demo-backstage";
import { type DemoMeters, DemoVoiceOrb, type OrbMode } from "@/components/demo-voice-orb";

// The call button, khairo.ai/demo's, on this repo's pipeline: instead of a Telnyx WebRTC call to our production line,
// the microphone goes to the demo server (src/demo/server.ts) over a WebSocket as 16 kHz PCM in 20 ms frames
// (public/mic-worklet.js), which streams it to Muse Voice Transcribe. What Muse heard, Muse Spark's replies, every tool
// call and its timing come back as JSON, shown in the log under the button; each reply comes back as ElevenLabs PCM,
// played as it arrives. While the receptionist talks the microphone sends silence, so it never hears itself (no
// barge-in in this local demo). After each tool the server sends the calendar as the garage sees it, which `onCall`
// passes to the behind-the-scenes panel (demo-backstage.tsx). The orb (demo-voice-orb.tsx) is khairo.ai/demo's.

type Phase = "idle" | "mic" | "connecting" | "live" | "ended";
export type DemoCallState = { phase: Phase | "error"; since: string | null; live: Live | null };
type State = { phase: Phase } | { phase: "error"; message: string };
type LogLine = { id: number; kind: "caller" | "agent" | "meta"; text: string };
type Player = { ctx: AudioContext; out: GainNode; playhead: number; lines: number; sampleRate: number };
type Session = { ws?: WebSocket; mic?: MediaStream; audio?: AudioContext; player?: Player; live?: boolean; startedAt?: number };
type Message =
  | { type: "ready"; sttOpenMs: number }
  | { type: "partial"; text: string }
  | { type: "heard"; text: string; endOfTurnMs: number }
  | { type: "say"; text: string }
  | { type: "audioStart"; sampleRate: number }
  | { type: "audioEnd"; firstByteMs: number | null }
  | { type: "tool"; name: string; input: unknown; result: Record<string, unknown>; ms: number }
  | { type: "language"; language: string }
  | { type: "spark"; firstTokenMs: number | null; totalMs: number; inputTokens: number; cachedInputTokens: number; outputTokens: number }
  | { type: "live"; live: Live }
  | { type: "error"; message: string };

// In development (pnpm --dir web dev) the page is on :3001 and the call server on :3000
const CALL_URL = process.env.NEXT_PUBLIC_CALL_URL;
const ERRORS = {
  unsupported: "This browser can't make calls. Try Chrome or Safari.",
  micBlocked: "Your microphone is blocked. Allow it for this page in your browser's settings and try again.",
  micMissing: "We couldn't find a microphone. Plug one in and try again.",
  connect: "We couldn't reach the call server. Is pnpm demo running? Check its terminal, then try again.",
  dropped: "The call dropped. Check the server's terminal, then try again.",
  line: "Something went wrong on the line. The log below says what.",
};
const ORB_MODE: Record<State["phase"], OrbMode> = {
  idle: "idle",
  mic: "waiting",
  connecting: "waiting",
  live: "live",
  ended: "ended",
  error: "error",
};

const elapsed = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

// A line still coming, its audio still playing, or the room's echo of the last word (0.25 s)
const talking = (p?: Player) => Boolean(p && (p.lines > 0 || p.ctx.currentTime < p.playhead + 0.25));

// One chunk of the receptionist's 16-bit PCM, scheduled right after the previous one
function play(p: Player, pcm: ArrayBuffer) {
  const samples = new Int16Array(pcm);
  const buffer = p.ctx.createBuffer(1, samples.length, p.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) channel[i] = samples[i]! / 0x8000;
  const source = p.ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(p.out);
  const at = Math.max(p.playhead, p.ctx.currentTime + 0.04);
  source.start(at);
  p.playhead = at + buffer.duration;
}

function describeTool(name: string, input: unknown, r: Record<string, unknown>) {
  const slots = r.slots as { time: string }[] | undefined;
  const detail = slots ? ` ${slots.map((s) => s.time).join(", ")}` : r.time ? ` ${String(r.weekday)} ${String(r.time)}` : "";
  return `⚙ ${name}(${JSON.stringify(input)}) → ${String(r.status)}${detail}`;
}

export function DemoCall({ onCall }: { onCall?: (call: DemoCallState) => void }) {
  const [state, setState] = useState<State>({ phase: "idle" });
  const [since, setSince] = useState<string | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [log, setLog] = useState<LogLine[]>([]);
  const [partial, setPartial] = useState("");
  const session = useRef<Session | null>(null);
  const meters = useRef<DemoMeters>({});
  const logBox = useRef<HTMLDivElement>(null);
  const lineId = useRef(0);

  const addLine = (kind: LogLine["kind"], text: string) => setLog((lines) => [...lines, { id: ++lineId.current, kind, text }]);

  // Close the socket and release the microphone and the audio. Safe to call twice; it forgets the session first, so
  // messages from the closing call can't move the state any more.
  function teardown() {
    const s = session.current;
    session.current = null;
    if (!s) return;
    s.ws?.close();
    s.mic?.getTracks().forEach((track) => track.stop());
    meters.current = {};
    s.audio?.close().catch(() => {});
    setPartial("");
  }

  function fail(own: Session, message: string) {
    if (session.current !== own) return;
    teardown();
    setState({ phase: "error", message });
  }

  async function start() {
    teardown();
    const own: Session = {};
    session.current = own;
    setSeconds(0);
    setLog([]);
    setLive(null);

    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") return fail(own, ERRORS.unsupported);
    // Created inside the click, before any await, so the browser lets it play
    const audio = new AudioContext();
    own.audio = audio;
    setState({ phase: "mic" });
    try {
      own.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      return fail(own, name === "NotFoundError" || name === "OverconstrainedError" ? ERRORS.micMissing : ERRORS.micBlocked);
    }
    // Hung up (or left the page) while the browser was asking
    if (session.current !== own) return own.mic.getTracks().forEach((track) => track.stop());

    // The receptionist's voice: played through a gain the orb's core listens to
    const out = audio.createGain();
    const agent = audio.createAnalyser();
    agent.fftSize = 1024;
    out.connect(agent);
    agent.connect(audio.destination);
    own.player = { ctx: audio, out, playhead: 0, lines: 0, sampleRate: 24000 };

    // The caller: 20 ms PCM frames from the worklet, and a meter for the orb's ring that goes quiet while the
    // receptionist talks (so its echo in the room doesn't light the caller's side)
    try {
      await audio.audioWorklet.addModule("/mic-worklet.js");
    } catch {
      return fail(own, ERRORS.unsupported);
    }
    if (session.current !== own) return;
    const source = audio.createMediaStreamSource(own.mic);
    const worklet = new AudioWorkletNode(audio, "mic-frames");
    source.connect(worklet);
    const gate = audio.createGain();
    const caller = audio.createAnalyser();
    caller.fftSize = 1024;
    source.connect(gate);
    gate.connect(caller);
    meters.current = { caller, agent };

    setState({ phase: "connecting" });
    setSince(new Date().toISOString());
    const ws = new WebSocket(CALL_URL || `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/call`);
    own.ws = ws;
    ws.binaryType = "arraybuffer";
    const silence = new Int16Array(320).buffer;
    worklet.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
      if (ws.readyState !== WebSocket.OPEN || !own.live) return;
      const quiet = talking(own.player);
      gate.gain.value = quiet ? 0 : 1;
      // While the receptionist talks, the line carries silence: it never hears itself
      ws.send(quiet ? silence : data);
    };

    ws.onmessage = ({ data }: MessageEvent<ArrayBuffer | string>) => {
      if (session.current !== own) return;
      if (data instanceof ArrayBuffer) return own.player && play(own.player, data);
      const msg = JSON.parse(data) as Message;
      const p = own.player;
      switch (msg.type) {
        case "ready":
          own.live = true;
          own.startedAt = Date.now();
          setState({ phase: "live" });
          addLine("meta", `muse-voice-transcribe · stream open in ${msg.sttOpenMs} ms`);
          return;
        case "partial":
          setPartial(msg.text);
          return;
        case "heard":
          setPartial("");
          if (!msg.text) return;
          addLine("caller", `you › ${msg.text}`);
          addLine("meta", `muse-voice-transcribe · end of turn ${msg.endOfTurnMs} ms after your last word`);
          return;
        case "say":
          addLine("agent", `receptionist › ${msg.text}`);
          if (p) p.lines++;
          return;
        case "audioStart":
          if (p) p.sampleRate = msg.sampleRate;
          return;
        case "audioEnd":
          if (p) p.lines = Math.max(0, p.lines - 1);
          if (msg.firstByteMs !== null) addLine("meta", `elevenlabs · first audio in ${msg.firstByteMs} ms`);
          return;
        case "tool":
          addLine("meta", describeTool(msg.name, msg.input, msg.result));
          return;
        case "language":
          addLine("meta", `↔ language · you're speaking ${msg.language === "bg" ? "Bulgarian" : "English"}: the call follows, on the same Muse stream`);
          return;
        case "spark":
          addLine(
            "meta",
            `muse-spark · first token ${msg.firstTokenMs ?? "–"} ms, done ${msg.totalMs} ms · ${msg.inputTokens} in (${msg.cachedInputTokens} cached), ${msg.outputTokens} out`,
          );
          return;
        case "live":
          setLive(msg.live);
          return;
        case "error":
          addLine("meta", `error · ${msg.message}`);
          return fail(own, ERRORS.line);
      }
    };
    ws.onerror = () => fail(own, own.live ? ERRORS.dropped : ERRORS.connect);
    ws.onclose = () => fail(own, own.live ? ERRORS.dropped : ERRORS.connect);
  }

  function hangUp() {
    teardown();
    setState({ phase: "ended" });
  }

  // The clock while the call is live
  useEffect(() => {
    if (state.phase !== "live") return;
    const startedAt = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [state.phase]);

  // The log follows its latest line
  useEffect(() => {
    const box = logBox.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [log, partial]);

  useEffect(() => () => teardown(), []);

  useEffect(() => onCall?.({ phase: state.phase, since, live }), [state.phase, since, live, onCall]);

  const inCall = state.phase === "mic" || state.phase === "connecting" || state.phase === "live";

  return (
    <div className="flex flex-col">
      <DemoVoiceOrb mode={ORB_MODE[state.phase]} meters={meters} />

      <div className="mt-3 min-h-[52px] text-center">
        {state.phase === "error" ? (
          <p role="alert" className="mx-auto max-w-sm text-[15px] font-medium leading-relaxed text-[oklch(0.82_0.1_28)]">
            {state.message}
          </p>
        ) : (
          <div role="status" aria-live="polite">
            <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[16px] font-bold text-white">
              {state.phase === "idle" && "Ready when you are."}
              {state.phase === "mic" && (
                <>
                  <Mic className="size-4 text-primary" strokeWidth={2.25} aria-hidden="true" />
                  Allow the microphone to start the call…
                </>
              )}
              {state.phase === "connecting" && "Connecting you to the receptionist…"}
              {state.phase === "live" && (
                <>
                  <span className="relative flex size-2.5" aria-hidden="true">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
                  </span>
                  Live
                  <span className="font-mono text-[15px] tabular-nums text-white/70">{elapsed(seconds)}</span>
                </>
              )}
              {state.phase === "ended" && `Call ended${seconds > 0 ? ` after ${elapsed(seconds)}` : ""}. Thanks for calling!`}
            </p>
            <p className="mt-1 text-[14px] text-muted-foreground">
              {state.phase === "idle" && "Your browser will ask to use the microphone."}
              {state.phase === "connecting" && "Opening a Muse Voice Transcribe stream."}
              {state.phase === "live" && "Go ahead and talk. Let the receptionist finish before you answer."}
              {state.phase === "ended" && "Try another booking, or cancel the one you made."}
            </p>
          </div>
        )}
      </div>

      {inCall ? (
        <button
          type="button"
          onClick={hangUp}
          className="mt-5 inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-[oklch(0.62_0.19_25)] px-7 text-[16px] font-bold text-white transition hover:bg-[oklch(0.67_0.19_25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <PhoneOff className="size-5" strokeWidth={2.25} aria-hidden="true" />
          Hang up
        </button>
      ) : (
        <button
          type="button"
          onClick={start}
          className="mt-5 inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-primary px-7 text-[16px] font-bold text-primary-foreground shadow-[0_18px_40px_-18px_oklch(0.8_0.15_158/0.7)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <Phone className="size-5" strokeWidth={2.25} aria-hidden="true" />
          {state.phase === "idle" ? "Talk to the receptionist" : "Call again"}
        </button>
      )}

      <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
        Runs on this machine: Muse Voice Transcribe hears you, Muse Spark answers and books, and ElevenLabs gives it a voice. Headphones
        work best.
      </p>
      <p className="mt-2.5 text-[13px] text-muted-foreground">
        Prefer your phone? Call{" "}
        <a
          href={`tel:${DEMO_PHONE}`}
          className="font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white"
        >
          {DEMO_PHONE_LABEL}
        </a>
      </p>

      {/* Under the hood: what Muse heard, what was said, every tool call and timing */}
      {(log.length > 0 || partial) && (
        <div className="mt-5 border-t border-white/10 pt-4">
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-primary">Under the hood</p>
          <div
            ref={logBox}
            className="mt-2.5 max-h-[300px] space-y-1.5 overflow-y-auto pr-1 font-mono text-[12px] leading-[1.55] [overflow-wrap:anywhere]"
            aria-live="off"
          >
            {log.map((line) => (
              <p
                key={line.id}
                className={line.kind === "caller" ? "text-white" : line.kind === "agent" ? "text-primary" : "text-white/45"}
              >
                {line.text}
              </p>
            ))}
            {partial && <p className="italic text-white/55">muse-voice-transcribe › {partial}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
