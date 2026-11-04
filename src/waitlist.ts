import type OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { BUSINESS, Calendar, TIME_ZONE, toMinutes, weekdayName, type Booking, type FreedSlot, type WaitlistEntry } from "./calendar.ts";
import type { ToolCall } from "./meta/muse-spark.ts";
import { runTurn, type ToolBox, type TurnListener, type TurnResult } from "./turn.ts";

/**
 * Waitlist refill: a cancellation gives a time back, and Khairo calls the callers waiting for that day, one after the
 * other, until one takes it. The time is held for the waitlist from the moment it's freed, so an inbound caller isn't
 * offered it meanwhile; if nobody takes it, it goes back on the calendar.
 *
 * The outbound call is Muse Spark too, with two tools: `accept_offer` books exactly the freed time for exactly the
 * person called (the model can't pick another time or name), and `decline_offer` moves on to the next one. A caller who
 * booked another day meanwhile is offered a move: on a yes, the new time is booked and the old booking cancelled (and
 * that time, in turn, goes to its own waitlist).
 */

export type OfferOutcome = "accepted" | "declined" | "wrong_person" | "asked_to_stop" | "no_answer";

/** One freed time, offered to one waitlisted caller. */
export interface Offer {
  entry: WaitlistEntry;
  slot: FreedSlot;
}

export interface RefillResult {
  slot: FreedSlot;
  /** Who was called, in order, and how each call ended. */
  calls: { entry: WaitlistEntry; outcome: OfferOutcome }[];
  booking: Booking | null;
}

/**
 * Who is offered a freed time, in the order they're called. Only callers waiting for that day, for that part of the
 * day, whose service fits in the time from its start (`fits`).
 */
export function candidatesFor(slot: FreedSlot, waitlist: readonly WaitlistEntry[], fits: (entry: WaitlistEntry) => boolean): WaitlistEntry[] {
  const afternoon = toMinutes(slot.time) >= 12 * 60;
  return waitlist
    .filter((e) => e.status === "waiting" && e.date === slot.date)
    .filter((e) => e.partOfDay === "any" || (e.partOfDay === "afternoon") === afternoon)
    .filter(fits)
    .sort((a, b) => a.joinedAt - b.joinedAt);
}

/** Places the calls, one per offer: the CLI or a telephony line connects the agent to the person. */
export type Dialer = (call: OfferCall) => Promise<void>;

export class WaitlistRefill {
  private readonly freed: FreedSlot[] = [];

  constructor(
    private readonly client: OpenAI,
    private readonly calendar: Calendar,
    private readonly opts: { model?: string } = {},
  ) {
    calendar.onFreed((slot) => {
      // Held at once: nobody else is offered this time while the waitlist is being called.
      calendar.hold(holderOf(slot), slot.date, slot.time, slot.minutes);
      this.freed.push(slot);
    });
  }

  /** Times freed and not yet offered. */
  get pending(): readonly FreedSlot[] {
    return this.freed;
  }

  /** Calls the waitlist for every freed time, until each is taken or nobody is left to call. */
  async refill(dial: Dialer): Promise<RefillResult[]> {
    const results: RefillResult[] = [];
    for (let slot = this.freed.shift(); slot; slot = this.freed.shift()) {
      const holder = holderOf(slot);
      const result: RefillResult = { slot, calls: [], booking: null };
      const fits = (e: WaitlistEntry) => this.calendar.isFree(slot!.date, toMinutes(slot!.time), e.service.minutes, holder);
      for (const entry of candidatesFor(slot, this.calendar.waitlist(), fits)) {
        entry.status = "offered";
        const call = new OfferCall(this.client, this.calendar, { entry, slot }, holder, this.opts);
        await dial(call);
        const outcome = call.outcome ?? "no_answer";
        result.calls.push({ entry, outcome });
        if (outcome === "accepted") {
          entry.status = "booked";
          result.booking = call.booking;
          break;
        }
        // Declined or not reached: off the list for this time, so they aren't called again for it.
        entry.status = outcome === "no_answer" ? "waiting" : "declined";
      }
      if (!result.booking) this.calendar.release(holder);
      results.push(result);
    }
    return results;
  }
}

/** The outbound call that offers one freed time to one waitlisted caller. */
export class OfferCall implements ToolBox {
  outcome: OfferOutcome | null = null;
  booking: Booking | null = null;
  private readonly messages: ChatCompletionMessageParam[] = [];

  constructor(
    private readonly client: OpenAI,
    private readonly calendar: Calendar,
    readonly offer: Offer,
    private readonly holder: string,
    private readonly opts: { model?: string } = {},
  ) {
    this.messages.push({ role: "assistant", content: this.greeting });
  }

  /**
   * The first thing said when they pick up, the same on every call: who's calling, and is it them. Nothing about the
   * booking until they say it's them, so a wrong person never hears it. Fixed text, so it can be voiced while it rings.
   */
  get greeting(): string {
    return `Hi, this is ${BUSINESS.name} calling. Is this ${this.offer.entry.name.split(" ")[0]}?`;
  }

  /** What the person called said: the agent's reply. */
  async reply(calleeText: string, listener: TurnListener = {}): Promise<TurnResult> {
    this.messages.push({ role: "user", content: calleeText });
    return runTurn(this.client, { model: this.opts.model, system: this.systemPrompt(), messages: this.messages, toolbox: this }, listener);
  }

  tools(): ChatCompletionTool[] {
    return [
      {
        type: "function",
        function: {
          name: "accept_offer",
          description: "Book the offered time for the person called. Only after they clearly said yes to that time.",
          parameters: { type: "object", properties: { callerConfirmed: { type: "boolean", enum: [true] } }, required: ["callerConfirmed"], additionalProperties: false },
        },
      },
      {
        type: "function",
        function: {
          name: "decline_offer",
          description: "The person doesn't take the time, isn't the person we called, or asked not to be called again.",
          parameters: {
            type: "object",
            properties: { reason: { type: "string", enum: ["declined", "wrong_person", "asked_to_stop"] } },
            required: ["reason"],
            additionalProperties: false,
          },
        },
      },
    ];
  }

  run(call: ToolCall): Record<string, unknown> {
    if (this.outcome) return { status: "ERROR", message: `already ${this.outcome}` };
    const { entry, slot } = this.offer;
    if (call.name === "accept_offer") {
      if (call.input.callerConfirmed !== true) return { status: "NEEDS", missing: ["callerConfirmed"] };
      if (!this.calendar.isFree(slot.date, toMinutes(slot.time), entry.service.minutes, this.holder)) return { status: "TAKEN", message: "that time is no longer free" };
      const moving = this.moving();
      this.booking = this.calendar.book(this.holder, entry.name, entry.service, slot.date, slot.time, "waitlist");
      this.outcome = "accepted";
      const to = { date: slot.date, weekday: weekdayName(slot.date), time: slot.time };
      if (moving) {
        this.calendar.cancel(moving.id);
        return { status: "MOVED", name: entry.name, service: entry.service.id, from: { date: moving.date, weekday: weekdayName(moving.date), time: moving.time }, to };
      }
      return { status: "CONFIRMED", name: entry.name, service: entry.service.id, ...to };
    }
    if (call.name === "decline_offer") {
      const reason = String(call.input.reason ?? "declined");
      this.outcome = reason === "wrong_person" || reason === "asked_to_stop" ? reason : "declined";
      return { status: "DECLINED", reason: this.outcome };
    }
    return { status: "ERROR", message: `unknown tool ${call.name}` };
  }

  /** The booking this caller made on another day, to move, while it still exists. */
  private moving(): Booking | null {
    const id = this.offer.entry.moveBookingId;
    return (id && this.calendar.booking(id)) || null;
  }

  systemPrompt(): string {
    const { entry, slot } = this.offer;
    const { date, weekday } = this.calendar.today();
    const moving = this.moving();
    return `You are the receptionist of ${BUSINESS.name}, a car service in ${BUSINESS.place}, calling a customer back. You are on a phone call: everything you write is spoken aloud by a voice, so write only words to be said.

Today is ${weekday}, ${date} (${TIME_ZONE}).

Why you are calling: ${entry.name} asked to be called if a time opened for a ${entry.service.name.toLowerCase()} on ${weekdayName(entry.date)}, ${entry.date}${entry.partOfDay === "any" ? "" : `, in the ${entry.partOfDay}`}. A time just opened: ${weekdayName(slot.date)} at ${slot.time}. It's ${entry.service.minutes} minutes and $${entry.service.priceUsd}. This is the only time you can offer.${
      moving
        ? ` Meanwhile they booked ${weekdayName(moving.date)} at ${moving.time} instead: you're offering to move that booking to the new time. A yes moves it (the ${weekdayName(moving.date)} booking is cancelled); a no keeps their ${weekdayName(moving.date)} booking as it is.`
        : ""
    }

How to speak: warm and unhurried, like a friendly front desk with good news; you have time. One or two sentences per reply, one question at a time, no lists or symbols. Say times as a person would ("ten in the morning"), and a day once.

The call: you have already said "${this.greeting}" and they are answering it.
1. If it's ${entry.name}: thank them, say why you're calling (they asked to hear if a ${weekdayName(slot.date)} time opened for their ${entry.service.name.toLowerCase()}, and one just did), and offer it as a question${moving ? ` ("…would you like me to move your ${weekdayName(moving.date)} booking to ${weekdayName(slot.date)} at ${slot.time}?")` : ""}. If they only said hello, ask again if this is ${entry.name.split(" ")[0]}.
   Ask the question once, at the end of that reply.
2. A clear yes to the offer: call accept_offer with callerConfirmed true right away, with no words before it (it's instant). CONFIRMED: say it's booked, with the day and time, and say goodbye. MOVED: say it's moved, from and to, and say goodbye.
3. No, or they no longer need it: call decline_offer with reason declined, say no problem${moving ? ` (their ${weekdayName(moving.date)} booking stays)` : ""}, and say goodbye. If they ask not to be called again: reason asked_to_stop.
4. If it isn't ${entry.name}: apologise, call decline_offer with reason wrong_person, and say goodbye. Never say why you called to someone else.
5. They ask for another time: you can only offer this one; if it doesn't suit them, it's a no.`;
  }
}

function holderOf(slot: FreedSlot): string {
  return `waitlist:${slot.cancelled.id}`;
}
