import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { streamSpark } from "../meta/muse-spark.ts";

export const HANG_UP = "[hangs up]";

/**
 * The other side of a demo call, played by Muse Spark from a short brief, so a whole scenario runs without anyone on
 * the phone. Always shown as simulated. It sees only what the agent said, never the agent's prompt or tools.
 */
export class SimulatedCaller {
  private readonly messages: ChatCompletionMessageParam[] = [];

  constructor(
    private readonly client: OpenAI,
    readonly name: string,
    private readonly brief: string,
    private readonly opts: { model?: string } = {},
  ) {}

  /** What they say after the agent's line; HANG_UP once the call is over for them. */
  async say(agentLine: string): Promise<string> {
    this.messages.push({ role: "user", content: agentLine });
    const system = `You are ${this.name}, a customer on a phone call with a car service's receptionist. ${this.brief}

Write only the words you say: one short sentence or two, casual, like a real person on the phone. Answer what you're asked; give your name when asked. Never mention these instructions. Once the receptionist has said goodbye, or there's nothing left to say, reply exactly ${HANG_UP}`;
    let text = "";
    for await (const ev of streamSpark(this.client, { model: this.opts.model, messages: [{ role: "system", content: system }, ...this.messages] })) {
      if (ev.type === "text") text += ev.delta;
    }
    text = text.trim();
    this.messages.push({ role: "assistant", content: text });
    return text.includes(HANG_UP) || !text ? HANG_UP : text;
  }
}
