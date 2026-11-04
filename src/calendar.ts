import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { ToolCall } from "./meta/muse-spark.ts";

/**
 * Golden Gate Auto Care, the demo car service behind khairo.ai/demo, and its calendar, in memory. The services, prices,
 * durations and hours are the live demo's. In production the same three tools go to our bookings service, which checks
 * every call against the business's rules; here they are enough to book a real-looking appointment end to end.
 *
 * The model never makes up a slot: `hold_slot` only takes a slot id that `find_slots` returned on this call, and
 * `service` is an enum of the catalog's ids. Every answer has a status (SLOTS, NO_SLOTS, HELD, TAKEN, CONFIRMED, NEEDS)
 * that the prompt tells the model how to handle.
 */
export const TIME_ZONE = "America/Los_Angeles";

export interface Service {
  id: string;
  name: string;
  minutes: number;
  priceUsd: number;
}

export const BUSINESS = {
  name: "Golden Gate Auto Care",
  place: "San Francisco, California",
  /** Weekday (0 = Sunday) → opening and closing time. */
  hours: { 1: ["08:00", "18:00"], 2: ["08:00", "18:00"], 3: ["08:00", "18:00"], 4: ["08:00", "18:00"], 5: ["08:00", "18:00"], 6: ["09:00", "14:00"] } as Record<number, [string, string]>,
  hoursSpoken: "Monday to Friday 8 am to 6 pm, Saturday 9 am to 2 pm, closed on Sunday",
  services: [
    { id: "oil_change", name: "Oil change", minutes: 45, priceUsd: 79 },
    { id: "tire_rotation", name: "Tire rotation", minutes: 30, priceUsd: 39 },
    { id: "brake_inspection", name: "Brake inspection", minutes: 30, priceUsd: 49 },
    { id: "check_engine_diagnostic", name: "Check-engine-light diagnostic", minutes: 60, priceUsd: 99 },
    { id: "smog_check", name: "California smog check", minutes: 30, priceUsd: 59 },
  ] satisfies Service[],
};

const GRID_MIN = 30;
/** Earliest a slot today may start, from now. */
const MIN_NOTICE_MIN = 60;
/** How far ahead find_slots looks when the asked day is full. */
const LOOKAHEAD_DAYS = 14;

export type PartOfDay = "morning" | "afternoon" | "any";

/** Times offered at once: everything offered is read aloud, and three with full dates took ~10 s to say on real calls. */
const OFFER = 2;
/** Offered times at least this far apart, so the caller gets a real choice (not 8:00 and 8:30). */
const SPREAD_MIN = 120;

/**
 * Which of a day's free start times ("HH:MM", sorted) to offer, as in production: the first free time, then the first
 * one at least two hours later; when the window is too short for that, the earliest others.
 */
export function pickOffers(free: string[]): string[] {
  const picked: string[] = [];
  for (const time of free) {
    if (picked.length === OFFER) break;
    const last = picked[picked.length - 1];
    if (!last || toMinutes(time) - toMinutes(last) >= SPREAD_MIN) picked.push(time);
  }
  for (const time of free) if (picked.length < OFFER && !picked.includes(time)) picked.push(time);
  return picked.sort();
}

export class Calendar {
  /** "YYYY-MM-DD HH:MM" grid cells booked on this run. */
  private readonly booked = new Set<string>();
  /** Slot ids find_slots returned on this call: the only ones hold_slot accepts. */
  private readonly offered = new Set<string>();
  private hold: { slotId: string; name: string; service: Service; date: string; time: string } | null = null;

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Today in the business's time zone, for the prompt. */
  today(): { date: string; weekday: string } {
    const { date } = localNow(this.now());
    return { date, weekday: weekdayName(date) };
  }

  /** Words the speech-to-text should hear right: the catalog plus booking words. */
  keyterms(): string[] {
    return [BUSINESS.name, ...BUSINESS.services.map((s) => s.name), "appointment", "smog check", "check engine light"];
  }

  tools(): ChatCompletionTool[] {
    return [
      {
        type: "function",
        function: {
          name: "find_slots",
          description: "Free start times for a service on a date. If that day is full or closed, returns the next day that has room.",
          parameters: {
            type: "object",
            properties: {
              service: { type: "string", enum: BUSINESS.services.map((s) => s.id), description: "The service's id from the catalog." },
              date: { type: "string", description: "The day the caller wants, YYYY-MM-DD, resolved from their words against today's date." },
              partOfDay: { type: "string", enum: ["morning", "afternoon", "any"], description: "morning: before 12:00; afternoon: from 12:00." },
            },
            required: ["service", "date"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "hold_slot",
          description: "Reserve one slot from the last find_slots while you read it back, under the name the booking is for.",
          parameters: {
            type: "object",
            properties: {
              slotId: { type: "string", description: "A slotId exactly as find_slots returned it." },
              name: { type: "string", description: "The name for the booking, as the caller said it." },
            },
            required: ["slotId", "name"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "confirm_booking",
          description: "Book the held slot. Only after reading back the name, weekday, date and time and hearing a clear yes.",
          parameters: {
            type: "object",
            properties: { callerConfirmed: { type: "boolean", enum: [true] } },
            required: ["callerConfirmed"],
            additionalProperties: false,
          },
        },
      },
    ];
  }

  run(call: ToolCall): Record<string, unknown> {
    const i = call.input;
    switch (call.name) {
      case "find_slots":
        return this.findSlots(String(i.service ?? ""), String(i.date ?? ""), (i.partOfDay as PartOfDay | undefined) ?? "any");
      case "hold_slot":
        return this.holdSlot(String(i.slotId ?? ""), String(i.name ?? "").trim());
      case "confirm_booking":
        return this.confirmBooking(i.callerConfirmed === true);
      default:
        return { status: "ERROR", message: `unknown tool ${call.name}` };
    }
  }

  private findSlots(serviceId: string, date: string, partOfDay: PartOfDay): Record<string, unknown> {
    const service = BUSINESS.services.find((s) => s.id === serviceId);
    if (!service) return { status: "ERROR", message: `unknown service; use one of ${BUSINESS.services.map((s) => s.id).join(", ")}` };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { status: "ERROR", message: "date must be YYYY-MM-DD" };
    const today = localNow(this.now()).date;
    if (date < today) return { status: "ERROR", message: `${date} is in the past; today is ${today}` };

    const asked = this.offer(service, date, partOfDay);
    if (asked.length) return { status: "SLOTS", service: service.id, date, weekday: weekdayName(date), slots: asked };
    for (let d = 1; d <= LOOKAHEAD_DAYS; d++) {
      const next = addDays(date, d);
      const slots = this.offer(service, next, partOfDay);
      if (slots.length) {
        return { status: "NO_SLOTS", date, reason: BUSINESS.hours[weekday(date)] ? "full" : "closed", nextAvailable: { date: next, weekday: weekdayName(next), slots } };
      }
    }
    return { status: "NO_SLOTS", date, reason: "full", nextAvailable: null };
  }

  private offer(service: Service, date: string, partOfDay: PartOfDay): { slotId: string; time: string }[] {
    const times = pickOffers(this.freeStarts(service, date, partOfDay));
    return times.map((time) => {
      const slotId = `${date}T${time}/${service.id}`;
      this.offered.add(slotId);
      return { slotId, time };
    });
  }

  private freeStarts(service: Service, date: string, partOfDay: PartOfDay): string[] {
    const hours = BUSINESS.hours[weekday(date)];
    if (!hours) return [];
    const [open, close] = hours.map(toMinutes) as [number, number];
    const now = localNow(this.now());
    const earliest = date === now.date ? now.minutes + MIN_NOTICE_MIN : 0;
    const free: string[] = [];
    for (let start = open; start + service.minutes <= close; start += GRID_MIN) {
      if (start < earliest) continue;
      if (partOfDay === "morning" && start >= 12 * 60) continue;
      if (partOfDay === "afternoon" && start < 12 * 60) continue;
      if (this.cellsOf(date, start, service.minutes).every((cell) => !this.isTaken(cell))) free.push(fromMinutes(start));
    }
    return free;
  }

  private holdSlot(slotId: string, name: string): Record<string, unknown> {
    if (!name) return { status: "NEEDS", missing: ["name"] };
    if (!this.offered.has(slotId)) return { status: "ERROR", message: "unknown slotId: offer only slots from find_slots" };
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})\/(\w+)$/.exec(slotId);
    const service = BUSINESS.services.find((s) => s.id === m?.[3]);
    if (!m || !service) return { status: "ERROR", message: "malformed slotId" };
    const [, date, time] = m as unknown as [string, string, string];
    if (this.cellsOf(date, toMinutes(time), service.minutes).some((cell) => this.isTaken(cell))) {
      return { status: "TAKEN", message: "that slot was just taken", slots: this.offer(service, date, "any") };
    }
    this.hold = { slotId, name, service, date, time };
    return { status: "HELD", name, service: service.id, date, weekday: weekdayName(date), time, minutes: service.minutes, priceUsd: service.priceUsd };
  }

  private confirmBooking(callerConfirmed: boolean): Record<string, unknown> {
    if (!callerConfirmed) return { status: "NEEDS", missing: ["callerConfirmed"] };
    if (!this.hold) return { status: "NEEDS", missing: ["hold_slot"] };
    const h = this.hold;
    for (const cell of this.cellsOf(h.date, toMinutes(h.time), h.service.minutes)) this.booked.add(cell);
    this.hold = null;
    return { status: "CONFIRMED", name: h.name, service: h.service.id, date: h.date, weekday: weekdayName(h.date), time: h.time };
  }

  private cellsOf(date: string, start: number, minutes: number): string[] {
    const cells: string[] = [];
    for (let t = start; t < start + minutes; t += GRID_MIN) cells.push(`${date} ${fromMinutes(t)}`);
    return cells;
  }

  /** Booked on this run, or by "other customers": a fixed third of the grid, the same on every run. */
  private isTaken(cell: string): boolean {
    if (this.booked.has(cell)) return true;
    let h = 0;
    for (const ch of cell) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 3 === 0;
  }
}

function localNow(d: Date): { date: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function weekdayName(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

function fromMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
