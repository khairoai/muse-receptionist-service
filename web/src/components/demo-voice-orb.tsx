"use client";

import { type ReactNode, type RefObject, useEffect, useRef } from "react";

// /demo's call visual: a voice orb on a canvas. The core is the receptionist (it swells with the remote audio level);
// the ring of ticks around it is the caller (they lengthen with the microphone level). Before the call it breathes,
// while connecting a light runs round the ring, while ringing the core sends out pulses. Levels come from Web Audio
// AnalyserNodes that demo-call.tsx owns; this only reads them. With reduced motion the orb is a still picture and only
// the "who's talking" legend changes. The legend shows before the call too, so the picture explains itself.

export type OrbMode = "idle" | "waiting" | "ringing" | "live" | "ended" | "error";
export type DemoMeters = { caller?: AnalyserNode; agent?: AnalyserNode };

const TICKS = 72;
const SPEAKING = 0.14; // the level above which the legend marks a side as talking

// RMS of the analyser's latest window, mapped from -58…-16 dBFS to 0…1.
function readLevel(analyser: AnalyserNode | undefined, buffer: Float32Array<ArrayBuffer>) {
  if (!analyser) return 0;
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (const sample of buffer) sum += sample * sample;
  const db = 20 * Math.log10(Math.sqrt(sum / buffer.length) + 1e-8);
  return Math.min(1, Math.max(0, (db + 58) / 42));
}

// Fast attack, slow release, so the orb follows syllables without flickering.
const follow = (current: number, target: number) => current + (target - current) * (target > current ? 0.45 : 0.1);

function draw(ctx: CanvasRenderingContext2D, size: number, mode: OrbMode, t: number, caller: number, agent: number) {
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);
  const core = size * 0.2;
  const ringIn = size * 0.31;
  const tickBase = size * 0.026;
  const tickMax = size * 0.17;
  const breath = 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 4.5);
  const dim = mode === "ended" || mode === "error"; // the error itself is said in words, under the orb

  // Ringing: two rings leave the core in turn
  if (mode === "ringing") {
    for (let k = 0; k < 2; k++) {
      const p = (t / 1.6 + k / 2) % 1;
      ctx.beginPath();
      ctx.arc(c, c, core + p * size * 0.28, 0, Math.PI * 2);
      ctx.strokeStyle = `oklch(0.8 0.15 158 / ${0.55 * (1 - p)})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // The caller's ring
  const head = (t * Math.PI * 2) / 1.6; // where the connecting light is
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

  // The receptionist's core, with a halo while it talks
  const swell = mode === "live" ? 1 + 0.3 * agent : mode === "idle" || mode === "ringing" ? 1 + 0.035 * breath : 1;
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

// children: what takes the legend's place while waiting for an answer (the progress line)
export function DemoVoiceOrb({ mode, meters, children }: { mode: OrbMode; meters: RefObject<DemoMeters>; children?: ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const you = useRef<HTMLSpanElement>(null);
  const them = useRef<HTMLSpanElement>(null);
  const waiting = mode === "waiting" || mode === "ringing";

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const buffer = new Float32Array(1024);
    let frame = 0;
    let caller = 0;
    let agent = 0;
    const startedAt = performance.now();

    const render = () => {
      const size = el.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      if (el.width !== Math.round(size * dpr)) {
        el.width = Math.round(size * dpr);
        el.height = Math.round(size * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (mode === "live") {
        caller = follow(caller, readLevel(meters.current.caller, buffer));
        agent = follow(agent, readLevel(meters.current.agent, buffer));
        you.current?.toggleAttribute("data-on", caller > SPEAKING);
        them.current?.toggleAttribute("data-on", agent > SPEAKING);
      }
      const t = reduced ? 0 : (performance.now() - startedAt) / 1000;
      draw(ctx, size, mode, t, reduced ? 0 : caller, reduced ? 0 : agent);
    };

    // Still modes draw once; with reduced motion only the live call keeps a loop, for the legend
    const loops = mode === "live" || (!reduced && (mode === "idle" || mode === "waiting" || mode === "ringing"));
    const tick = () => {
      render();
      if (loops) frame = requestAnimationFrame(tick);
    };
    tick();
    const resize = new ResizeObserver(() => render());
    resize.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
    };
  }, [mode, meters]);

  return (
    <div className="flex flex-col items-center">
      <canvas ref={canvas} className="aspect-square w-[152px] sm:w-[224px]" aria-hidden="true" />
      <p
        className={`flex items-center gap-4 text-[12.5px] font-semibold text-white/45 transition-opacity duration-300 ${
          mode === "live" ? "opacity-100" : waiting ? "hidden" : "opacity-60"
        }`}
        aria-hidden="true"
      >
        <span ref={you} className="group flex items-center gap-1.5 transition-colors data-[on]:text-white">
          <i className="size-1.5 rounded-full bg-white/40 group-data-[on]:bg-white" />
          You
        </span>
        <span ref={them} className="group flex items-center gap-1.5 transition-colors data-[on]:text-primary">
          <i className="size-1.5 rounded-full bg-primary/40 group-data-[on]:bg-primary" />
          Receptionist
        </span>
      </p>
      {children}
    </div>
  );
}
