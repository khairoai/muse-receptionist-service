"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Ban, CalendarCheck, CalendarClock, Hourglass, MoveRight, Phone, Search } from "lucide-react";
import type { DemoCallState } from "@/components/demo-call";

// khairo.ai/demo's "behind the scenes": what the garage's owner sees while the visitor talks to the receptionist. Once a
// call starts it takes the place of the hero's copy (demo-hero.tsx): five days of the garage's calendar, and the
// activity on the line below (times checked, a slot held while the caller confirms, the booking made). The times the
// receptionist offers light up in the calendar's gaps: they're the same free times. On khairo.ai it polls our
// production server; here the call's own server sends it after every tool (src/demo/live.ts), and demo-call.tsx passes
// it in. Other customers' time shows as grey busy blocks; this call's bookings are marked as "just now". Motion: the
// header, calendar and feed come in one after another; a booking drops into its slot, a hold breathes while it waits,
// and when it's confirmed a ring goes out from it once; new feed lines slide in at the top.

type Item =
  | {
      id: string;
      kind: "booking";
      status: "held" | "confirmed";
      by: "call" | "owner";
      name: string;
      service: string;
      date: string;
      starts: string;
      ends: string;
      lane: string | null;
      holdExpiresAt: string | null;
      recent: boolean;
    }
  | { id: string; kind: "busy"; date: string; starts: string; ends: string; lane: string | null };

type Activity =
  | { kind: "offered"; at: string; date: string; day: string | null; slots: string[] }
  | {
      kind: "held" | "confirmed" | "moved" | "cancelled" | "expired";
      at: string;
      date: string;
      name: string;
      service: string;
      when: string;
    };

type Day = { date: string; label: string; long: string; opens: string | null; closes: string | null };

export type Live = {
  now: string;
  today: string;
  /** The day the call is about (its latest offer or booking), or null before it asks. */
  focus: string | null;
  days: Day[];
  lanes: string[];
  items: Item[];
  /** The times the caller is choosing among now. */
  offered: { date: string; time: string; person: string | null }[];
  activity: Activity[];
};

const PX_PER_MIN = 0.78;
/** Each mechanic's colour: the edge of their bookings and their dot in the legend. */
const LANE_COLOURS = ["oklch(0.6 0.13 158)", "oklch(0.62 0.12 235)", "oklch(0.68 0.14 60)"];
const EASE = [0.22, 1, 0.36, 1] as const;
/** The panel's parts, one after another, once it has risen in (demo-hero.tsx). */
const enter = (step: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, delay: 0.45 + step * 0.1, ease: EASE },
});

const minutes = (time: string) => {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return h * 60 + m;
};
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;
const clock = (time: string) => {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}`;
};

function ago(at: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  return s < 5 ? "just now" : s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

function useLive(call: DemoCallState) {
  const onLine = call.phase === "connecting" || call.phase === "live";
  return { live: call.live, skew: 0, onLine };
}

// A second's clock for the countdowns and the "12s ago"s
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function Calendar({ live, now }: { live: Live; now: number }) {
  const open = live.days.filter((d) => d.opens);
  const opens = Math.min(...open.map((d) => minutes(d.opens!)), 8 * 60);
  const closes = Math.max(...open.map((d) => minutes(d.closes!)), 18 * 60);
  const lanes = live.lanes.length ? live.lanes : ["Calendar"];
  const height = (closes - opens) * PX_PER_MIN;
  const hours: number[] = [];
  for (let h = Math.ceil(opens / 60); h * 60 <= closes; h++) hours.push(h);
  const y = (time: string) => (minutes(time) - opens) * PX_PER_MIN;
  // A mechanic's half (or third) of the day; with no mechanic, the whole day
  const placeIn = (lane: string | null) => {
    const i = lane ? lanes.indexOf(lane) : -1;
    if (i < 0) return { left: 2, right: 2 };
    return { left: `calc(${(i / lanes.length) * 100}% + 2px)`, width: `calc(${100 / lanes.length}% - 4px)` };
  };

  return (
    <div>
      <div className="flex items-center gap-4 text-[12px] font-semibold">
        {lanes.map((lane, i) => (
          <span key={lane} className="flex items-center gap-1.5 opacity-75">
            <i className="size-2 rounded-full" style={{ background: LANE_COLOURS[i % LANE_COLOURS.length] }} />
            {lane}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-1.5 opacity-60">
          <i className="h-2 w-4 rounded-sm border border-dashed border-emerald-600" />
          Free time offered on the call
        </span>
      </div>

      <div className="mt-3 grid grid-cols-[38px_1fr] gap-1.5">
        <span />
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${live.days.length}, minmax(0, 1fr))` }}>
          {live.days.map((d) => (
            <p
              key={d.date}
              className={`truncate rounded-lg px-1.5 py-1 text-center text-[12px] font-bold transition-colors duration-500 ${d.date === live.focus ? "bg-emerald-600 text-white" : "opacity-70"}`}
            >
              {d.date === live.today ? "Today" : d.label.split(",")[0]} {d.label.split(" ").at(-1)}
            </p>
          ))}
        </div>
      </div>

      <div className="mt-1.5 grid grid-cols-[38px_1fr] gap-1.5">
        <div className="relative" style={{ height }}>
          {hours.map((h) => (
            <span
              key={h}
              className="absolute -translate-y-1/2 font-mono text-[10.5px] tabular-nums opacity-45"
              style={{ top: (h * 60 - opens) * PX_PER_MIN }}
            >
              {hourLabel(h)}
            </span>
          ))}
        </div>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${live.days.length}, minmax(0, 1fr))` }}>
          {live.days.map((d) => (
            <div
              key={d.date}
              className={`relative rounded-lg transition-colors duration-500 ${d.date === live.focus ? "bg-emerald-50 ring-1 ring-emerald-600/25" : "bg-white/60"}`}
              style={{ height }}
            >
              {hours.map((h) => (
                <span
                  key={h}
                  className="absolute inset-x-0 border-t border-dashed border-[oklch(0.9_0.015_150)]"
                  style={{ top: (h * 60 - opens) * PX_PER_MIN }}
                />
              ))}
              {/* Before opening and after closing */}
              {[
                [opens, d.opens ? minutes(d.opens) : closes],
                [d.closes ? minutes(d.closes) : closes, closes],
              ].map(([from, to], i) =>
                to! > from! ? (
                  <span
                    key={i}
                    className="absolute inset-x-0 rounded-lg bg-[repeating-linear-gradient(135deg,oklch(0.93_0.008_150),oklch(0.93_0.008_150)_5px,transparent_5px,transparent_10px)] opacity-70"
                    style={{ top: (from! - opens) * PX_PER_MIN, height: (to! - from!) * PX_PER_MIN }}
                  />
                ) : null,
              )}

              {live.items
                .filter((item) => item.date === d.date)
                .map((item) => {
                  const top = y(item.starts);
                  const h = Math.max(14, (minutes(item.ends) - minutes(item.starts)) * PX_PER_MIN - 2);
                  const place = placeIn(item.lane);
                  if (item.kind === "busy")
                    return (
                      <span
                        key={item.id}
                        className="absolute rounded-md bg-[oklch(0.9_0.01_150)]"
                        style={{ top, height: h, ...place }}
                        title="Busy in the owner's calendar"
                      />
                    );
                  const held = item.status === "held";
                  const mine = item.recent;
                  const lane = item.lane ? lanes.indexOf(item.lane) : -1;
                  const edge = LANE_COLOURS[(lane < 0 ? 0 : lane) % LANE_COLOURS.length];
                  const left = held && item.holdExpiresAt ? Math.max(0, Math.round((Date.parse(item.holdExpiresAt) - now) / 1000)) : null;
                  const tone = held
                    ? "border-2 border-dashed border-amber-500 bg-amber-50 text-amber-950 slot-held"
                    : mine
                      ? "bg-emerald-600 text-white shadow-[0_10px_24px_-10px_oklch(0.5_0.14_158/0.8)]"
                      : item.by === "call"
                        ? "bg-emerald-100 text-emerald-950"
                        : "bg-[oklch(0.95_0.008_150)] text-[oklch(0.35_0.02_160)]";
                  return (
                    <motion.div
                      key={item.id}
                      layout
                      initial={{ opacity: 0, y: -8, scale: 0.92 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ type: "spring", stiffness: 380, damping: 28, layout: { duration: 0.6, ease: EASE } }}
                      className={`absolute ${held || mine ? "z-10" : ""}`}
                      style={{ top, height: h, ...place }}
                      title={`${clock(item.starts)}–${clock(item.ends)} ${item.service} · ${item.name}${item.lane ? ` · ${item.lane}` : ""}`}
                    >
                      {!held && mine && (
                        <motion.span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 rounded-md border-2 border-emerald-500"
                          initial={{ opacity: 0.9, scale: 1 }}
                          animate={{ opacity: 0, scale: 1.6 }}
                          transition={{ duration: 1.2, ease: "easeOut" }}
                        />
                      )}
                      <div
                        className={`h-full overflow-hidden rounded-md border-l-[3px] px-1 py-px leading-[1.15] transition-[background-color,color,box-shadow] duration-700 ${tone}`}
                        style={{ borderLeftColor: held ? undefined : mine ? "white" : edge }}
                      >
                        <p className="truncate text-[10.5px] font-bold tabular-nums">
                          {clock(item.starts)}
                          {held && left !== null ? ` · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : ""}
                        </p>
                        {h > 24 && <p className="truncate text-[10px] opacity-80">{held || mine ? item.name : item.service}</p>}
                      </div>
                    </motion.div>
                  );
                })}

              {/* The free times the receptionist just offered: the gaps it read out */}
              <AnimatePresence>
                {live.offered
                  .filter((o) => o.date === d.date)
                  .map((o) => (
                    <motion.span
                      key={`${o.date}-${o.time}-${o.person ?? ""}`}
                      aria-hidden="true"
                      className="absolute z-20 grid place-items-center rounded-md border-2 border-dashed border-emerald-600 bg-emerald-400/20 text-[10px] font-bold text-emerald-900 backdrop-blur-[1px]"
                      style={{ top: y(o.time), height: Math.max(16, 30 * PX_PER_MIN), ...placeIn(o.person) }}
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: [0, 1, 0.75, 1], scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.9, ease: EASE }}
                    >
                      {clock(o.time)}
                    </motion.span>
                  ))}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const ACTIVITY: Record<Activity["kind"], typeof Search> = {
  offered: Search,
  held: Hourglass,
  confirmed: CalendarCheck,
  moved: MoveRight,
  cancelled: Ban,
  expired: CalendarClock,
};

function describe(a: Activity) {
  switch (a.kind) {
    case "offered":
      return { title: `Checked ${a.day ?? "the calendar"}`, body: `Free: ${a.slots.join(", ")}` };
    case "held":
      return { title: `Held ${a.when}`, body: `${a.service} for ${a.name}, while they confirm` };
    case "confirmed":
      return { title: `Booked ${a.when}`, body: `${a.service} for ${a.name}` };
    case "moved":
      return { title: `Moved to ${a.when}`, body: `${a.service} for ${a.name}` };
    case "cancelled":
      return { title: `Cancelled ${a.when}`, body: `${a.service} for ${a.name}` };
    case "expired":
      return { title: `Hold released ${a.when}`, body: `${a.service}: no answer in time` };
  }
}

export function DemoBackstage({ call }: { call: DemoCallState }) {
  const { live, skew, onLine } = useLive(call);
  const now = useNow(onLine || Boolean(live?.items.some((i) => i.kind === "booking" && i.status === "held"))) + skew;
  const activity = [...(live?.activity ?? [])].reverse();
  const heading = live
    ? (live.days.find((d) => d.date === live.focus)?.long ?? `${live.days[0]?.label ?? ""} – ${live.days.at(-1)?.label ?? ""}`)
    : "Loading the calendar…";

  return (
    <section
      aria-label="Behind the scenes: the garage's calendar"
      className="rounded-[30px] border border-[oklch(0.89_0.025_158)] bg-[oklch(0.985_0.003_150)] p-5 text-[oklch(0.2_0.03_165)] shadow-[0_50px_100px_-50px_oklch(0.1_0.04_165)] sm:p-6"
    >
      <motion.header {...enter(0)} className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-emerald-700">Behind the scenes</p>
          <p className="mt-1 text-[18px] font-extrabold leading-tight">What the garage sees</p>
        </div>
        <div className="text-right">
          <p className="flex items-center justify-end gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-700">
            <span
              className={`size-1.5 rounded-full ${onLine ? "bg-emerald-500 motion-safe:animate-pulse" : "bg-[oklch(0.75_0.01_150)]"}`}
              aria-hidden="true"
            />
            {onLine ? "Live" : "Call ended"}
          </p>
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={heading}
              className="mt-1 text-[14px] font-bold"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              {heading}
            </motion.p>
          </AnimatePresence>
        </div>
      </motion.header>

      <div className="mt-5 grid gap-6">
        <motion.div {...enter(1)} className="grid">
          {/* The placeholder fades into the calendar, and one day into another when the call moves to it */}
          <AnimatePresence initial={false}>
            <motion.div
              key={live?.days[0]?.date ?? "loading"}
              className="[grid-area:1/1]"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.5, ease: EASE }}
            >
              {live ? (
                <Calendar live={live} now={now} />
              ) : (
                <div className="h-[520px] animate-pulse rounded-2xl bg-[oklch(0.95_0.01_150)]" />
              )}
            </motion.div>
          </AnimatePresence>
        </motion.div>

        <motion.div {...enter(2)} className="min-w-0">
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] opacity-55">On the line</p>
          <ol className="mt-3 grid max-h-[230px] gap-3 overflow-y-auto pr-1 sm:grid-cols-2" aria-live="polite">
            <AnimatePresence initial={false}>
              {activity.map((a) => {
                const Icon = ACTIVITY[a.kind];
                const { title, body } = describe(a);
                const good = a.kind === "confirmed";
                return (
                  <motion.li
                    key={`${a.kind}-${a.at}`}
                    layout
                    initial={{ opacity: 0, x: -14, scale: 0.97 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    transition={{ duration: 0.5, ease: EASE }}
                    className="flex gap-2.5"
                  >
                    <span
                      className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ${good ? "bg-emerald-600 text-white" : a.kind === "held" ? "bg-amber-100 text-amber-800" : "bg-[oklch(0.94_0.015_150)] text-emerald-800"}`}
                    >
                      <Icon className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-bold leading-snug">{title}</span>
                      <span className="block text-[12.5px] leading-snug opacity-70">{body}</span>
                      <span className="block text-[11px] opacity-45">{ago(a.at, now)}</span>
                    </span>
                  </motion.li>
                );
              })}
            </AnimatePresence>
            <motion.li layout transition={{ duration: 0.5, ease: EASE }} className="flex gap-2.5">
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-[oklch(0.94_0.015_150)] text-emerald-800">
                <Phone className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
              </span>
              <span className="text-[13px] leading-snug opacity-70">
                {activity.length
                  ? "Your call started"
                  : "Ask for an appointment. The times it checks, holds and books show up here as it happens."}
              </span>
            </motion.li>
          </ol>
        </motion.div>
      </div>
    </section>
  );
}
