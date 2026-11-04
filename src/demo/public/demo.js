// The call card: the microphone goes to the server (server.ts) as 16 kHz PCM, which streams it to Muse Voice
// Transcribe; what Muse heard, Muse Spark's replies and every tool call come back and are shown in the log. Each reply
// comes back as ElevenLabs PCM, played as it arrives. While the receptionist talks, the microphone sends silence, so it
// never hears itself (no barge-in in this local demo). The orb is khairo.ai/demo's, drawn the same way.

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const hintEl = $("hint");
const button = $("call");
const log = $("log");

// ---- The orb (khairo.ai/demo's demo-voice-orb.tsx) ----
const TICKS = 72;
const SPEAKING = 0.14;
const follow = (current, target) => current + (target - current) * (target > current ? 0.45 : 0.1);

function readLevel(analyser, buffer) {
  if (!analyser) return 0;
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (const sample of buffer) sum += sample * sample;
  const db = 20 * Math.log10(Math.sqrt(sum / buffer.length) + 1e-8);
  return Math.min(1, Math.max(0, (db + 58) / 42));
}

function draw(ctx, size, mode, t, caller, agent) {
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);
  const core = size * 0.2;
  const ringIn = size * 0.31;
  const tickBase = size * 0.026;
  const tickMax = size * 0.17;
  const breath = 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 4.5);
  const dim = mode === "ended" || mode === "error";

  const head = (t * Math.PI * 2) / 1.6;
  for (let i = 0; i < TICKS; i++) {
    const angle = (i / TICKS) * Math.PI * 2 - Math.PI / 2;
    let length = tickBase;
    let alpha = dim ? 0.14 : 0.22;
    if (mode === "idle") length = tickBase * (1 + 0.5 * Math.sin(angle * 3 + t * 0.9));
    if (mode === "waiting") {
      const behind = (((head - (angle + Math.PI / 2)) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const glow = Math.max(0, 1 - behind / (Math.PI * 0.9));
      alpha += 0.7 * glow;
      length = tickBase * (1 + 1.4 * glow);
    }
    if (mode === "live") {
      const grain = 0.55 + 0.45 * Math.sin(angle * 5 + t * 7) * Math.sin(angle * 2 - t * 3.1);
      length = tickBase + tickMax * caller * grain;
      alpha = 0.3 + 0.65 * caller;
    }
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(c + cos * ringIn, c + sin * ringIn);
    ctx.lineTo(c + cos * (ringIn + length), c + sin * (ringIn + length));
    ctx.strokeStyle = `oklch(0.95 0.04 158 / ${alpha})`;
    ctx.lineWidth = Math.max(1.5, size * 0.009);
    ctx.lineCap = "round";
    ctx.stroke();
  }

  const swell = mode === "live" ? 1 + 0.3 * agent : mode === "idle" ? 1 + 0.035 * breath : 1;
  const radius = core * swell;
  if (mode === "live" && agent > 0.02) {
    const halo = ctx.createRadialGradient(c, c, radius * 0.8, c, c, radius * 1.9);
    halo.addColorStop(0, `oklch(0.8 0.15 158 / ${0.45 * agent})`);
    halo.addColorStop(1, "oklch(0.8 0.15 158 / 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(c, c, radius * 1.9, 0, Math.PI * 2);
    ctx.fill();
  }
  const fill = ctx.createRadialGradient(c - radius * 0.2, c - radius * 0.25, radius * 0.05, c, c, radius);
  const a = dim ? 0.35 : mode === "waiting" ? 0.6 + 0.25 * breath : 1;
  fill.addColorStop(0, `oklch(0.93 0.09 160 / ${a})`);
  fill.addColorStop(0.55, `oklch(0.8 0.15 158 / ${a})`);
  fill.addColorStop(1, `oklch(0.55 0.12 165 / ${a})`);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(c, c, radius, 0, Math.PI * 2);
  ctx.fill();
}

let mode = "idle";
const meters = { caller: undefined, agent: undefined };
{
  const el = $("orb");
  const ctx = el.getContext("2d");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const buffer = new Float32Array(1024);
  const startedAt = performance.now();
  let caller = 0;
  let agent = 0;
  const tick = () => {
    const size = el.clientWidth;
    const dpr = window.devicePixelRatio || 1;
    if (el.width !== Math.round(size * dpr)) {
      el.width = Math.round(size * dpr);
      el.height = Math.round(size * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const t = (performance.now() - startedAt) / 1000;
    if (mode === "live") {
      caller = follow(caller, receptionistTalking() ? 0 : readLevel(meters.caller, buffer));
      agent = follow(agent, readLevel(meters.agent, buffer));
      $("you").toggleAttribute("data-on", caller > SPEAKING);
      $("them").toggleAttribute("data-on", agent > SPEAKING);
    }
    draw(ctx, size, mode, reduced ? 0 : t, reduced ? 0 : caller, reduced ? 0 : agent);
    requestAnimationFrame(tick);
  };
  tick();
}

// ---- The log: what Muse heard, what was said, every tool call and timing ----
let partialLine = null;
function line(cls, text) {
  const p = document.createElement("p");
  p.className = cls;
  p.textContent = text;
  log.insertBefore(p, partialLine);
  log.scrollTop = log.scrollHeight;
  return p;
}
function showPartial(text) {
  if (!partialLine) {
    partialLine = document.createElement("p");
    partialLine.className = "partial";
    log.append(partialLine);
  }
  partialLine.textContent = `muse-voice-transcribe › ${text}`;
  log.scrollTop = log.scrollHeight;
}
function clearPartial() {
  partialLine?.remove();
  partialLine = null;
}

// ---- The receptionist's voice: ElevenLabs PCM, scheduled back to back as it arrives ----
let player = null; // { ctx, out, playhead, lines, sampleRate }
function receptionistTalking() {
  if (!player) return false;
  // A line still coming, its audio still playing, or the room's echo of the last word (0.25 s)
  return player.lines > 0 || player.ctx.currentTime < player.playhead + 0.25;
}
function play(pcm) {
  if (!player) return;
  const samples = new Int16Array(pcm);
  const buffer = player.ctx.createBuffer(1, samples.length, player.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 0x8000;
  const source = player.ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(player.out);
  const at = Math.max(player.playhead, player.ctx.currentTime + 0.04);
  source.start(at);
  player.playhead = at + buffer.duration;
}

// ---- The call ----
let session = null;

function setStatus(title, hint, error = false) {
  statusEl.textContent = title;
  statusEl.className = error ? "error" : "";
  hintEl.textContent = hint;
}

function teardown() {
  const s = session;
  session = null;
  if (!s) return;
  s.ws?.close();
  s.mic?.getTracks().forEach((track) => track.stop());
  s.audio?.close().catch(() => {});
  meters.caller = undefined;
  meters.agent = undefined;
  player = null;
  clearPartial();
}

function fail(message) {
  teardown();
  mode = "error";
  setStatus(message, "Check the server's terminal, then try again.", true);
  button.textContent = "Call again";
  button.className = "";
}

async function start() {
  teardown();
  const own = {};
  session = own;
  log.querySelectorAll("p").forEach((p) => p.remove());
  button.textContent = "Hang up";
  button.className = "hangup";
  mode = "waiting";
  setStatus("Allow the microphone to start the call…", "");

  try {
    own.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch {
    return fail("Your microphone is blocked. Allow it for this page and try again.");
  }
  if (session !== own) return own.mic.getTracks().forEach((t) => t.stop());

  // Created inside the click, so the browser lets it play
  own.audio = new AudioContext();
  const out = own.audio.createGain();
  const agentMeter = own.audio.createAnalyser();
  agentMeter.fftSize = 1024;
  out.connect(agentMeter);
  agentMeter.connect(own.audio.destination);
  meters.agent = agentMeter;
  player = { ctx: own.audio, out, playhead: 0, lines: 0, sampleRate: 24000 };
  await own.audio.audioWorklet.addModule("/mic-worklet.js");
  const source = own.audio.createMediaStreamSource(own.mic);
  const worklet = new AudioWorkletNode(own.audio, "mic-frames");
  source.connect(worklet);
  const analyser = own.audio.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  meters.caller = analyser;

  setStatus("Connecting you to the receptionist…", "Opening a Muse Voice Transcribe stream.");
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/call`);
  own.ws = ws;
  ws.binaryType = "arraybuffer";
  const silence = new Int16Array(320).buffer;
  worklet.port.onmessage = ({ data }) => {
    if (ws.readyState !== WebSocket.OPEN || !own.live) return;
    // While the receptionist talks, the line carries silence: it never hears itself
    ws.send(receptionistTalking() ? silence : data);
  };

  ws.onmessage = ({ data }) => {
    if (session !== own) return;
    if (data instanceof ArrayBuffer) return play(data);
    const msg = JSON.parse(data);
    switch (msg.type) {
      case "ready":
        own.live = true;
        own.startedAt = Date.now();
        mode = "live";
        setStatus("Live", "Go ahead and talk. Wait for the receptionist to finish before you answer.");
        line("meta", `muse-voice-transcribe · stream open in ${msg.sttOpenMs} ms`);
        return;
      case "partial":
        showPartial(msg.text);
        return;
      case "heard":
        clearPartial();
        if (!msg.text) return;
        line("caller", `you › ${msg.text}`);
        line("meta", `muse-voice-transcribe · end of turn ${msg.endOfTurnMs} ms after your last word`);
        return;
      case "say":
        line("agent", `receptionist › ${msg.text}`);
        if (player) player.lines++;
        return;
      case "audioStart":
        if (player) player.sampleRate = msg.sampleRate;
        return;
      case "audioEnd":
        if (player) player.lines = Math.max(0, player.lines - 1);
        if (msg.firstByteMs !== null) line("meta", `elevenlabs · first audio in ${msg.firstByteMs} ms`);
        return;
      case "tool": {
        const r = msg.result;
        const detail = r.slots ? ` ${r.slots.map((s) => s.time).join(", ")}` : r.time ? ` ${r.weekday} ${r.time}` : "";
        line("meta", `⚙ ${msg.name}(${JSON.stringify(msg.input)}) → ${r.status}${detail}`);
        return;
      }
      case "spark":
        line("meta", `muse-spark · first token ${msg.firstTokenMs ?? "–"} ms, done ${msg.totalMs} ms · ${msg.inputTokens} in (${msg.cachedInputTokens} cached), ${msg.outputTokens} out`);
        return;
      case "error":
        line("meta", `error · ${msg.message}`);
        return fail("Something went wrong on the line.");
    }
  };
  ws.onclose = () => {
    if (session === own) fail("The call dropped.");
  };
}

function hangUp() {
  const seconds = session?.startedAt ? Math.round((Date.now() - session.startedAt) / 1000) : 0;
  teardown();
  mode = "ended";
  setStatus(`Call ended${seconds ? ` after ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : ""}. Thanks for calling!`, "Try another booking.");
  button.textContent = "Call again";
  button.className = "";
}

button.addEventListener("click", () => (session ? hangUp() : start()));
