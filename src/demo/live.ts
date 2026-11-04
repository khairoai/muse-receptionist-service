import { addDays, BUSINESS, type Calendar, serviceById, toMinutes } from "../calendar.ts";

/**
 * The demo page's "behind the scenes" panel (web/src/components/demo-backstage.tsx): what the garage's owner sees while
 * the visitor talks. Five open days of the call's calendar, the other customers' bookings as busy time, and what this
 * call did on it: the times offered, the slot held, the booking made or cancelled. The same shape khairo.ai/demo's
 * panel reads from our production server; here it's built from the call's tool results and sent over the call's
 * WebSocket after each one, instead of polled.
 */
const DAYS_SHOWN = 5;
const GRID_MIN = 30;

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
  | { kind: "held" | "confirmed" | "cancelled"; at: string; date: string; name: string; service: string; when: string };

export type Live = {
  now: string;
  today: string;
  focus: string | null;
  days: { date: string; label: string; long: string; opens: string | null; closes: string | null }[];
  lanes: string[];
  items: Item[];
  offered: { date: string; time: string; person: string | null }[];
  activity: Activity[];
};

/** "Thu, Nov 5" or "Thursday, November 5". */
function dayLabel(date: string, width: "short" | "long"): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: width, day: "numeric", month: width }).format(new Date(`${date}T12:00:00Z`));
}

/** "09:00" → "9:00 AM". */
function clock(time: string): string {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function fromMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

const serviceName = (id: unknown) => serviceById(String(id))?.name ?? String(id);

/** One call's panel: feed it every tool result, read `snapshot()` after each. */
export class LiveView {
  private readonly activity: Activity[] = [];
  /** Bookings made on this call, which the panel marks as "just now". */
  private readonly made = new Set<string>();
  private offered: Live["offered"] = [];
  private held: { name: string; service: string; date: string; time: string; minutes: number } | null = null;

  constructor(private readonly calendar: Calendar) {}

  record(tool: string, result: Record<string, unknown>): void {
    const at = new Date().toISOString();
    const status = result.status;
    if (tool === "find_slots" && (status === "SLOTS" || status === "NO_SLOTS")) {
      const next = result.nextAvailable as { date: string; slots: { time: string }[] } | null | undefined;
      const date = status === "SLOTS" ? String(result.date) : next?.date;
      const slots = status === "SLOTS" ? (result.slots as { time: string }[]) : (next?.slots ?? []);
      if (!date || !slots.length) return;
      this.offered = slots.map((s) => ({ date, time: s.time, person: null }));
      this.activity.push({ kind: "offered", at, date, day: dayLabel(date, "short"), slots: slots.map((s) => clock(s.time)) });
    } else if (tool === "hold_slot" && status === "HELD") {
      const date = String(result.date);
      const time = String(result.time);
      this.held = { name: String(result.name), service: serviceName(result.service), date, time, minutes: Number(result.minutes) };
      this.offered = [];
      this.activity.push({ kind: "held", at, date, name: this.held.name, service: this.held.service, when: `${dayLabel(date, "short")}, ${clock(time)}` });
    } else if (tool === "confirm_booking" && status === "CONFIRMED") {
      const date = String(result.date);
      this.made.add(String(result.bookingId));
      this.held = null;
      this.activity.push({ kind: "confirmed", at, date, name: String(result.name), service: serviceName(result.service), when: `${dayLabel(date, "short")}, ${clock(String(result.time))}` });
    } else if (tool === "cancel_booking" && status === "CANCELLED") {
      const date = String(result.date);
      this.activity.push({ kind: "cancelled", at, date, name: String(result.name), service: serviceName(result.service), when: `${dayLabel(date, "short")}, ${clock(String(result.time))}` });
    }
  }

  snapshot(): Live {
    const today = this.calendar.today().date;
    // Open days from today; when the call is about a day past the first five, they move along to show it
    const openDays: string[] = [];
    for (let i = 0; openDays.length < 30 && i < 60; i++) {
      const date = addDays(today, i);
      if (BUSINESS.hours[weekday(date)]) openDays.push(date);
    }
    const focus = this.activity.at(-1)?.date ?? null;
    const index = focus ? openDays.indexOf(focus) : -1;
    const start = index >= DAYS_SHOWN ? index - 2 : 0;
    const shown = openDays.slice(start, start + DAYS_SHOWN);

    const items: Item[] = [];
    for (const date of shown) {
      const [opens, closes] = BUSINESS.hours[weekday(date)]!.map(toMinutes) as [number, number];
      // Other customers' time, as busy blocks (consecutive half-hours merged)
      let busyFrom: number | null = null;
      for (let t = opens; t <= closes; t += GRID_MIN) {
        const taken = t < closes && this.calendar.whoHas(date, fromMinutes(t)) === "other customer";
        if (taken && busyFrom === null) busyFrom = t;
        if (!taken && busyFrom !== null) {
          items.push({ id: `busy-${date}-${busyFrom}`, kind: "busy", date, starts: fromMinutes(busyFrom), ends: fromMinutes(t), lane: null });
          busyFrom = null;
        }
      }
    }
    for (const b of this.calendar.listBookings()) {
      if (!shown.includes(b.date)) continue;
      items.push({
        id: b.id,
        kind: "booking",
        status: "confirmed",
        by: b.source === "owner" ? "owner" : "call",
        name: b.name,
        service: b.service.name,
        date: b.date,
        starts: b.time,
        ends: fromMinutes(toMinutes(b.time) + b.service.minutes),
        lane: null,
        holdExpiresAt: null,
        recent: this.made.has(b.id),
      });
    }
    if (this.held && shown.includes(this.held.date)) {
      const h = this.held;
      items.push({
        id: `hold-${h.date}-${h.time}`,
        kind: "booking",
        status: "held",
        by: "call",
        name: h.name,
        service: h.service,
        date: h.date,
        starts: h.time,
        ends: fromMinutes(toMinutes(h.time) + h.minutes),
        lane: null,
        holdExpiresAt: null,
        recent: true,
      });
    }

    return {
      now: new Date().toISOString(),
      today,
      focus,
      days: shown.map((date) => {
        const hours = BUSINESS.hours[weekday(date)];
        return { date, label: dayLabel(date, "short"), long: dayLabel(date, "long"), opens: hours?.[0] ?? null, closes: hours?.[1] ?? null };
      }),
      lanes: [],
      items,
      offered: this.offered,
      activity: this.activity,
    };
  }
}

