import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { ToolCall } from "./meta/muse-spark.ts";
import type { ToolBox } from "./turn.ts";

/**
 * Golden Gate Auto Care, the demo car service behind khairo.ai/demo, and its calendar, in memory. The services, prices,
 * durations and hours are the live demo's. In production the same tools go to our bookings service, which checks every
 * call against the business's rules; here they are enough to book, cancel and refill a real-looking day end to end.
 *
 * One `Calendar` is the business's day, shared by every call; each call gets its own `BookingSession` (`session()`),
 * which is what the model's tools reach. The model never makes up a slot or a booking: `hold_slot` only takes a slot id
 * that `find_slots` returned on this call, `cancel_booking` only a booking id that `find_booking` returned on this call,
 * and `service` is an enum of the catalog's ids. Every answer has a status (SLOTS, NO_SLOTS, HELD, TAKEN, CONFIRMED,
 * FOUND, NOT_FOUND, CANCELLED, WAITLISTED, NEEDS) that the prompt tells the model how to handle.
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

export interface Booking {
  id: string;
  name: string;
  service: Service;
  date: string;
  time: string;
  /** How it was made: on a call, by the owner, or by a waitlist call back. */
  source: "call" | "owner" | "waitlist";
}

/** A caller who wanted a full day and agreed to be called if a time opens on it. */
export interface WaitlistEntry {
  id: string;
  name: string;
  service: Service;
  date: string;
  partOfDay: PartOfDay;
  /** When they joined: who asked first. */
  joinedAt: number;
  status: "waiting" | "offered" | "booked" | "declined";
}

/** The time a cancellation gave back, for the waitlist. */
export interface FreedSlot {
  date: string;
  time: string;
  minutes: number;
  cancelled: Booking;
}

export class Calendar {
  /** "YYYY-MM-DD HH:MM" grid cell → the booking in it. */
  private readonly booked = new Map<string, string>();
  private readonly bookings = new Map<string, Booking>();
  /** Grid cell → who holds it (a call reading a slot back, or a waitlist offer). Nobody else is offered it. */
  private readonly holds = new Map<string, string>();
  private readonly waiting: WaitlistEntry[] = [];
  private readonly freedListeners: ((slot: FreedSlot) => void)[] = [];
  private ids = 0;

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Today in the business's time zone, for the prompt. */
  today(): { date: string; weekday: string } {
    const { date } = localNow(this.now());
    return { date, weekday: weekdayName(date) };
  }

  /** Words the speech-to-text should hear right: the catalog plus booking words. */
  keyterms(): string[] {
    return [BUSINESS.name, ...BUSINESS.services.map((s) => s.name), "appointment", "smog check", "check engine light", "cancel", "waitlist"];
  }

  /** The tools one call's model gets, with that call's own state. */
  session(): BookingSession {
    return new BookingSession(this, this.nextId("call"));
  }

  /** Called on every cancellation, with the time it gave back. */
  onFreed(listener: (slot: FreedSlot) => void): void {
    this.freedListeners.push(listener);
  }

  /** A booking the owner already had (the day as it stands when calls start). Null when the time isn't free. */
  addBooking(name: string, serviceId: string, date: string, time: string): Booking | null {
    const service = serviceById(serviceId);
    if (!service || !this.isFree(date, toMinutes(time), service.minutes)) return null;
    return this.book("owner", name, service, date, time, "owner");
  }

  listBookings(): Booking[] {
    return [...this.bookings.values()].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  }

  /** Who has a half-hour of the grid: a booking, "other customer", or null when free. */
  whoHas(date: string, time: string): Booking | "other customer" | null {
    const cell = `${date} ${time}`;
    const id = this.booked.get(cell);
    if (id) return this.bookings.get(id) ?? null;
    return this.isTaken(cell) ? "other customer" : null;
  }

  waitlist(): readonly WaitlistEntry[] {
    return this.waiting;
  }

  /** Free start times ("HH:MM") for a service on a date; times `holder` holds count as free for it. */
  freeStarts(service: Service, date: string, partOfDay: PartOfDay, holder?: string): string[] {
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
      if (this.isFree(date, start, service.minutes, holder)) free.push(fromMinutes(start));
    }
    return free;
  }

  isFree(date: string, start: number, minutes: number, holder?: string): boolean {
    return cellsOf(date, start, minutes).every((cell) => !this.isTaken(cell) && (!this.holds.has(cell) || this.holds.get(cell) === holder));
  }

  /** Holds the time for `holder` (dropping what it held before). False when it isn't free for it. */
  hold(holder: string, date: string, time: string, minutes: number): boolean {
    if (!this.isFree(date, toMinutes(time), minutes, holder)) return false;
    this.release(holder);
    for (const cell of cellsOf(date, toMinutes(time), minutes)) this.holds.set(cell, holder);
    return true;
  }

  release(holder: string): void {
    for (const [cell, who] of this.holds) if (who === holder) this.holds.delete(cell);
  }

  /** Books a time that is free for `holder`, and drops its hold. */
  book(holder: string, name: string, service: Service, date: string, time: string, source: Booking["source"]): Booking {
    const booking: Booking = { id: this.nextId("bk"), name, service, date, time, source };
    this.release(holder);
    for (const cell of cellsOf(date, toMinutes(time), service.minutes)) this.booked.set(cell, booking.id);
    this.bookings.set(booking.id, booking);
    return booking;
  }

  /** Upcoming bookings under a name: every word the caller said is in it ("Maria" finds "Maria Lopez"). */
  findBookings(name: string): Booking[] {
    const words = normalize(name).split(" ").filter(Boolean);
    const today = localNow(this.now()).date;
    if (!words.length) return [];
    return this.listBookings().filter((b) => b.date >= today && words.every((w) => normalize(b.name).split(" ").includes(w)));
  }

  /** Cancels a booking, then tells the listeners (the waitlist) which time came free. */
  cancel(bookingId: string): Booking | null {
    const booking = this.bookings.get(bookingId);
    if (!booking) return null;
    this.bookings.delete(bookingId);
    for (const [cell, id] of this.booked) if (id === bookingId) this.booked.delete(cell);
    const freed: FreedSlot = { date: booking.date, time: booking.time, minutes: booking.service.minutes, cancelled: booking };
    for (const listener of this.freedListeners) listener(freed);
    return booking;
  }

  joinWaitlist(name: string, service: Service, date: string, partOfDay: PartOfDay): WaitlistEntry {
    const entry: WaitlistEntry = { id: this.nextId("wl"), name, service, date, partOfDay, joinedAt: this.now().getTime(), status: "waiting" };
    this.waiting.push(entry);
    return entry;
  }

  private nextId(prefix: string): string {
    return `${prefix}_${++this.ids}`;
  }

  /** Booked here, or by "other customers": a fixed third of the grid, the same on every run. */
  private isTaken(cell: string): boolean {
    if (this.booked.has(cell)) return true;
    let h = 0;
    for (const ch of cell) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 3 === 0;
  }
}

/** One call's tools on the shared calendar, with what this call was offered, holds and found. */
export class BookingSession implements ToolBox {
  /** Slot ids find_slots returned on this call: the only ones hold_slot accepts. */
  private readonly offered = new Set<string>();
  /** Booking ids find_booking returned on this call: the only ones cancel_booking accepts. */
  private readonly found = new Set<string>();
  private held: { name: string; service: Service; date: string; time: string } | null = null;

  constructor(
    private readonly calendar: Calendar,
    /** This call, as the holder of what it holds. */
    readonly id: string,
  ) {}

  /** The call ended: whatever it still holds is free again. */
  end(): void {
    this.calendar.release(this.id);
  }

  tools(): ChatCompletionTool[] {
    const serviceParam = { type: "string", enum: BUSINESS.services.map((s) => s.id), description: "The service's id from the catalog." };
    const dateParam = { type: "string", description: "The day the caller wants, YYYY-MM-DD, resolved from their words against today's date." };
    const partOfDayParam = { type: "string", enum: ["morning", "afternoon", "any"], description: "morning: before 12:00; afternoon: from 12:00." };
    const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[]): ChatCompletionTool => ({
      type: "function",
      function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
    });
    return [
      fn("find_slots", "Free start times for a service on a date. If that day is full or closed, returns the next day that has room.", { service: serviceParam, date: dateParam, partOfDay: partOfDayParam }, ["service", "date"]),
      fn(
        "hold_slot",
        "Reserve one slot from the last find_slots while you read it back, under the name the booking is for.",
        { slotId: { type: "string", description: "A slotId exactly as find_slots returned it." }, name: { type: "string", description: "The name for the booking, as the caller said it." } },
        ["slotId", "name"],
      ),
      fn("confirm_booking", "Book the held slot. Only after reading back the name, weekday, date and time and hearing a clear yes.", { callerConfirmed: { type: "boolean", enum: [true] } }, ["callerConfirmed"]),
      fn("find_booking", "The caller's upcoming bookings, by the name the booking is under. Before moving or cancelling one.", { name: { type: "string", description: "The name the booking is under, as the caller said it." } }, ["name"]),
      fn(
        "cancel_booking",
        "Cancel one booking find_booking returned. Only after reading it back (service, weekday, time) and hearing a clear yes.",
        { bookingId: { type: "string", description: "A bookingId exactly as find_booking returned it." }, callerConfirmed: { type: "boolean", enum: [true] } },
        ["bookingId", "callerConfirmed"],
      ),
      fn(
        "join_waitlist",
        "Put the caller on the waitlist for a day that is full: if a time opens that day, we call them and offer it. Only when they asked for that.",
        { service: serviceParam, date: dateParam, partOfDay: partOfDayParam, name: { type: "string", description: "The caller's name." }, callbackOk: { type: "boolean", enum: [true], description: "The caller agreed to be called back." } },
        ["service", "date", "name", "callbackOk"],
      ),
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
      case "find_booking":
        return this.findBooking(String(i.name ?? "").trim());
      case "cancel_booking":
        return this.cancelBooking(String(i.bookingId ?? ""), i.callerConfirmed === true);
      case "join_waitlist":
        return this.joinWaitlist(String(i.service ?? ""), String(i.date ?? ""), (i.partOfDay as PartOfDay | undefined) ?? "any", String(i.name ?? "").trim(), i.callbackOk === true);
      default:
        return { status: "ERROR", message: `unknown tool ${call.name}` };
    }
  }

  private findSlots(serviceId: string, date: string, partOfDay: PartOfDay): Record<string, unknown> {
    const service = serviceById(serviceId);
    if (!service) return { status: "ERROR", message: `unknown service; use one of ${BUSINESS.services.map((s) => s.id).join(", ")}` };
    const bad = checkDate(date, this.calendar.today().date);
    if (bad) return bad;

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
    return pickOffers(this.calendar.freeStarts(service, date, partOfDay, this.id)).map((time) => {
      const slotId = `${date}T${time}/${service.id}`;
      this.offered.add(slotId);
      return { slotId, time };
    });
  }

  private holdSlot(slotId: string, name: string): Record<string, unknown> {
    if (!name) return { status: "NEEDS", missing: ["name"] };
    if (!this.offered.has(slotId)) return { status: "ERROR", message: "unknown slotId: offer only slots from find_slots" };
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})\/(\w+)$/.exec(slotId);
    const service = serviceById(m?.[3] ?? "");
    if (!m || !service) return { status: "ERROR", message: "malformed slotId" };
    const [, date, time] = m as unknown as [string, string, string];
    if (!this.calendar.hold(this.id, date, time, service.minutes)) {
      return { status: "TAKEN", message: "that slot was just taken", slots: this.offer(service, date, "any") };
    }
    this.held = { name, service, date, time };
    return { status: "HELD", name, service: service.id, date, weekday: weekdayName(date), time, minutes: service.minutes, priceUsd: service.priceUsd };
  }

  private confirmBooking(callerConfirmed: boolean): Record<string, unknown> {
    if (!callerConfirmed) return { status: "NEEDS", missing: ["callerConfirmed"] };
    if (!this.held) return { status: "NEEDS", missing: ["hold_slot"] };
    const h = this.held;
    const booking = this.calendar.book(this.id, h.name, h.service, h.date, h.time, "call");
    this.held = null;
    return { status: "CONFIRMED", bookingId: booking.id, name: h.name, service: h.service.id, date: h.date, weekday: weekdayName(h.date), time: h.time };
  }

  private findBooking(name: string): Record<string, unknown> {
    if (!name) return { status: "NEEDS", missing: ["name"] };
    const bookings = this.calendar.findBookings(name);
    if (!bookings.length) return { status: "NOT_FOUND", name };
    for (const b of bookings) this.found.add(b.id);
    return { status: "FOUND", bookings: bookings.map((b) => ({ bookingId: b.id, name: b.name, service: b.service.id, date: b.date, weekday: weekdayName(b.date), time: b.time })) };
  }

  private cancelBooking(bookingId: string, callerConfirmed: boolean): Record<string, unknown> {
    if (!this.found.has(bookingId)) return { status: "ERROR", message: "unknown bookingId: cancel only a booking find_booking returned" };
    if (!callerConfirmed) return { status: "NEEDS", missing: ["callerConfirmed"] };
    const booking = this.calendar.cancel(bookingId);
    if (!booking) return { status: "ERROR", message: "that booking is no longer there" };
    this.found.delete(bookingId);
    return { status: "CANCELLED", name: booking.name, service: booking.service.id, date: booking.date, weekday: weekdayName(booking.date), time: booking.time };
  }

  private joinWaitlist(serviceId: string, date: string, partOfDay: PartOfDay, name: string, callbackOk: boolean): Record<string, unknown> {
    const service = serviceById(serviceId);
    if (!service) return { status: "ERROR", message: `unknown service; use one of ${BUSINESS.services.map((s) => s.id).join(", ")}` };
    const bad = checkDate(date, this.calendar.today().date);
    if (bad) return bad;
    const missing = [...(name ? [] : ["name"]), ...(callbackOk ? [] : ["callbackOk"])];
    if (missing.length) return { status: "NEEDS", missing };
    const entry = this.calendar.joinWaitlist(name, service, date, partOfDay);
    const position = this.calendar.waitlist().filter((e) => e.status === "waiting" && e.date === date).indexOf(entry) + 1;
    return { status: "WAITLISTED", name, service: service.id, date, weekday: weekdayName(date), partOfDay, position };
  }
}

export function serviceById(id: string): Service | undefined {
  return BUSINESS.services.find((s) => s.id === id);
}

function checkDate(date: string, today: string): Record<string, unknown> | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { status: "ERROR", message: "date must be YYYY-MM-DD" };
  if (date < today) return { status: "ERROR", message: `${date} is in the past; today is ${today}` };
  return null;
}

function cellsOf(date: string, start: number, minutes: number): string[] {
  const cells: string[] = [];
  for (let t = start; t < start + minutes; t += GRID_MIN) cells.push(`${date} ${fromMinutes(t)}`);
  return cells;
}

function normalize(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
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

export function weekdayName(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

function fromMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
