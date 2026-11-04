import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { BUSINESS, Calendar, TIME_ZONE } from "./calendar.ts";
import { streamSpark, type SparkUsage, type ToolCall } from "./meta/muse-spark.ts";

/** Model rounds per caller turn: speak, call a tool, speak about its answer, … */
const MAX_ROUNDS = 4;

export const GREETING = `${BUSINESS.name}, hello! How can I help?`;

export interface Round {
  firstTokenMs: number | null;
  totalMs: number;
  text: string;
  toolCalls: { call: ToolCall; result: Record<string, unknown>; ms: number }[];
  usage: SparkUsage;
}

export interface TurnResult {
  /** What the receptionist says, in order (text before a tool call, then after its answer). */
  spoken: string;
  rounds: Round[];
}

/** As a turn happens: each line to say as soon as its round ends (so the echo plays while the tool runs), each tool. */
export interface TurnListener {
  say?: (text: string) => void;
  tool?: (t: Round["toolCalls"][number]) => void;
}

/**
 * One phone call's receptionist on Muse Spark: the caller's words in, what to say out. Books only through the
 * calendar's tools.
 */
export class Receptionist {
  private readonly messages: ChatCompletionMessageParam[] = [];

  constructor(
    private readonly client: OpenAI,
    private readonly calendar: Calendar,
    private readonly opts: { model?: string } = {},
  ) {
    this.messages.push({ role: "assistant", content: GREETING });
  }

  get greeting(): string {
    return GREETING;
  }

  async reply(callerText: string, listener: TurnListener = {}): Promise<TurnResult> {
    this.messages.push({ role: "user", content: callerText });

    const rounds: Round[] = [];
    const spoken: string[] = [];
    for (let i = 0; i < MAX_ROUNDS; i++) {
      const round: Round = { firstTokenMs: null, totalMs: 0, text: "", toolCalls: [], usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 } };
      const calls: ToolCall[] = [];
      const messages: ChatCompletionMessageParam[] = [{ role: "system", content: this.systemPrompt() }, ...this.messages];
      for await (const ev of streamSpark(this.client, { model: this.opts.model, messages, tools: this.calendar.tools() })) {
        if (ev.type === "text") round.text += ev.delta;
        else if (ev.type === "toolCall") calls.push(ev.call);
        else Object.assign(round, { firstTokenMs: ev.firstTokenMs, totalMs: ev.totalMs, usage: ev.usage });
      }
      round.text = round.text.trim();
      if (round.text) {
        spoken.push(round.text);
        listener.say?.(round.text);
      }
      this.messages.push({
        role: "assistant",
        content: round.text,
        ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}),
      });
      for (const call of calls) {
        const started = performance.now();
        const result = this.calendar.run(call);
        const done = { call, result, ms: performance.now() - started };
        round.toolCalls.push(done);
        listener.tool?.(done);
        this.messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
      rounds.push(round);
      if (!calls.length) break;
    }
    return { spoken: spoken.join(" "), rounds };
  }

  /** The prompt for the call as it is now (today's date). */
  systemPrompt(): string {
    const { date, weekday } = this.calendar.today();
    const services = BUSINESS.services.map((s) => `- ${s.id}: ${s.name}, ${s.minutes} min, $${s.priceUsd}`).join("\n");
    return `You are the receptionist of ${BUSINESS.name}, a car service in ${BUSINESS.place}. You are on a phone call: everything you write is spoken aloud by a voice, so write only words to be said.

Today is ${weekday}, ${date} (${TIME_ZONE}).

How to speak:
- One or two short sentences per reply, and one question at a time. No lists, markdown, emoji or symbols.
- Say dates as weekday and day ("Thursday the fifth"), times as a person would ("nine in the morning", "half past two").
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
TAKEN: that time just went; offer the slots it returned. NEEDS: ask for what is missing.`;
  }
}
