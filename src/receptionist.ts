import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { BUSINESS, Calendar, TIME_ZONE, type BookingSession } from "./calendar.ts";
import { decideLanguage, lettersByLanguage, scriptsOf, withoutAddresses, wordCount } from "./language.ts";
import type { ReasoningEffort } from "./meta/muse-spark.ts";
import { runTurn, type TurnListener, type TurnResult } from "./turn.ts";

export type { Round, TurnListener, TurnResult } from "./turn.ts";

export type Language = "en" | "bg";
const LANGUAGES: Language[] = ["en", "bg"];
const LANGUAGE_NAMES: Record<Language, string> = { en: "English", bg: "Bulgarian" };

export const GREETING = `${BUSINESS.name}, hello! How can I help?`;

export interface ReceptionistTurn extends TurnResult {
  /** The call's language for this reply, and whether the caller's words just switched it. */
  language: Language;
  switchedLanguage: boolean;
}

/**
 * One phone call's receptionist on Muse Spark: the caller's words in, what to say out. Books, cancels and waitlists only
 * through its call's calendar session. Follows the caller's language by the script of their words (language.ts): Muse
 * Voice Transcribe writes Bulgarian in Cyrillic even on a stream biased to English, so the reply to a caller's first
 * Bulgarian sentence is already in Bulgarian.
 */
export class Receptionist {
  private readonly messages: ChatCompletionMessageParam[] = [];
  readonly session: BookingSession;
  private language: Language = "en";
  private callerTurns = 0;
  private readonly scripts = scriptsOf(LANGUAGES);

  constructor(
    private readonly client: OpenAI,
    private readonly calendar: Calendar,
    private readonly opts: { model?: string; reasoningEffort?: ReasoningEffort; callerPhone?: string } = {},
  ) {
    this.session = calendar.session({ callerPhone: opts.callerPhone });
    this.messages.push({ role: "assistant", content: GREETING });
  }

  get greeting(): string {
    return GREETING;
  }

  async reply(callerText: string, listener: TurnListener = {}): Promise<ReceptionistTurn> {
    const switchedLanguage = this.followLanguage(callerText);
    this.callerTurns++;
    this.messages.push({ role: "user", content: callerText });
    const turn = await runTurn(this.client, { model: this.opts.model, reasoningEffort: this.opts.reasoningEffort, system: this.systemPrompt(), messages: this.messages, toolbox: this.session }, listener);
    return { ...turn, language: this.language, switchedLanguage };
  }

  /** The call ended: whatever it still holds is free again. */
  hangUp(): void {
    this.session.end();
  }

  /** Switch the call's language when the caller's words are clearly in the other script. */
  private followLanguage(text: string): boolean {
    if (!this.scripts) return false;
    const clean = withoutAddresses(text);
    const next = decideLanguage({ letters: lettersByLanguage(clean, this.scripts), words: wordCount(clean), current: this.language, firstTurn: this.callerTurns === 0 });
    if (!next || next === this.language) return false;
    this.language = next as Language;
    return true;
  }

  /** The prompt for the call as it is now (language, today's date). */
  systemPrompt(): string {
    const { date, weekday } = this.calendar.today();
    const services = BUSINESS.services.map((s) => `- ${s.id}: ${s.name}, ${s.minutes} min, $${s.priceUsd}`).join("\n");
    const language = LANGUAGE_NAMES[this.language];
    return `You are the receptionist of ${BUSINESS.name}, a car service in ${BUSINESS.place}. You are on a phone call: everything you write is spoken aloud by a voice, so write only words to be said.

Today is ${weekday}, ${date} (${TIME_ZONE}).

The caller is speaking ${language}: reply only in ${language}. Prices stay in dollars.

How to speak:
- One or two short sentences per reply, and one question at a time. No lists, markdown, emoji or symbols.
- Say dates as weekday and day ("Thursday the fifth"), times as a person would ("nine in the morning", "half past two").
- Keep it brisk, like a busy front desk: say a day once, then its times ("Tuesday, at eight or ten"), not "in the morning" after every time. Reuse the caller's own words for the day ("Monday") instead of the full date.
- Never invent prices, opening hours, services or free times. Everything you know is below or comes from a tool. If you don't know, say you will pass the question to the team.
- When you need a tool, start your reply with a short echo of what the caller just gave you, with their specifics ("An oil change tomorrow morning."), then call the tool in the same reply. It is spoken while the tool runs, so the caller never waits in silence. Never a generic filler without their specifics ("one moment", "hold on").

Services (id: name, duration, price):
${services}

Opening hours: ${BUSINESS.hoursSpoken}.

Booking, in this order:
1. Know the service and the day. Then call find_slots, resolving words like "tomorrow" or "next Friday" against today's date.
2. SLOTS: offer the times it returned and ask which suits them, nothing else in that reply. NO_SLOTS: say that day is full or closed and offer nextAvailable.
3. When the caller picks a time, ask for the name for the booking if you don't have it, then call hold_slot.
4. HELD: read back name, service, weekday, date and time, and ask "Is that right?" Never tell the caller what words to say.
5. Only after a clear yes, call confirm_booking with callerConfirmed true. CONFIRMED: say it's booked and say goodbye.
TAKEN: that time just went; offer the slots it returned. NEEDS: ask for what is missing.

Waitlist: when the day the caller wants is full, offer the nextAvailable times and, in the same short reply, that you can also put them on the waitlist for the day they wanted, so you call and move them if something opens ("Monday's full. Tuesday I have eight or ten, and I can put you on Monday's waitlist and call you if a time opens. Want that?"). If they want that, book the other day first as above (pick a time, name, read back, confirm). Then call join_waitlist for the day they wanted, with their name, callbackOk true and moveBookingId from CONFIRMED. If they don't want another day at all, call join_waitlist without moveBookingId. WAITLISTED: say they're booked on the other day and on the waitlist for the day they wanted, and that you'll call if something opens; say goodbye.

Cancelling: call find_booking with the name the booking is under; if the caller already said their name, use it right away, never ask for it again. FOUND: read back the service, weekday and time and ask if they want it cancelled. Only after a clear yes, call cancel_booking with that bookingId and callerConfirmed true. CANCELLED: say it's cancelled and say goodbye. NOT_FOUND: ask for the name again, once.`;
  }
}
