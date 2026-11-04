import type OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { streamSpark, type ReasoningEffort, type SparkUsage, type ToolCall } from "./meta/muse-spark.ts";

/** Model rounds per turn: speak, call a tool, speak about its answer, … */
const MAX_ROUNDS = 4;

/** A whole sentence at the start of the text: up to . ! or ?, then a space and more text. */
const SENTENCE = /^([\s\S]*?[.!?…]["'”»)]?)\s+(?=\S)/;

/**
 * Said to the model, for one round only, when its first round neither called a tool nor asked the caller anything.
 * Muse Spark sometimes says "I'll pull up your booking now" and stops there: 3 of 20 such turns in our benchmark
 * (docs/benchmarks/muse-spark-for-voice.md). The caller then hears a promise and silence, with nothing to answer.
 */
const DANGLING_NOTE =
  "You told the caller you would check or do something, but you didn't call a tool, and you asked them nothing. If you said you'd check or do something, call the tool now. Otherwise reply with nothing.";

/** What an agent may do on a call: its tools, and the code that answers them. The model never decides on its own. */
export interface ToolBox {
  tools(): ChatCompletionTool[];
  run(call: ToolCall): Record<string, unknown>;
}

export interface Round {
  firstTokenMs: number | null;
  totalMs: number;
  text: string;
  toolCalls: { call: ToolCall; result: Record<string, unknown>; ms: number }[];
  usage: SparkUsage;
  /** This round ran because the one before it promised something and stopped (DANGLING_NOTE). */
  nudged?: boolean;
}

export interface TurnResult {
  /** What the agent says, in order (text before a tool call, then after its answer). */
  spoken: string;
  rounds: Round[];
}

/** As a turn happens: each sentence to say as soon as Muse has written it (so the echo plays while the tool runs), each tool. */
export interface TurnListener {
  say?: (text: string) => void;
  tool?: (t: Round["toolCalls"][number]) => void;
}

/**
 * One agent turn on Muse Spark: rounds until one ends without a tool call. Each round's text is spoken as soon as the
 * round ends, its tool calls run in code, and their answers go back to the model. `messages` is the call so far and
 * gets this turn appended.
 */
export async function runTurn(
  client: OpenAI,
  req: { model?: string; reasoningEffort?: ReasoningEffort; system: string; messages: ChatCompletionMessageParam[]; toolbox: ToolBox },
  listener: TurnListener = {},
): Promise<TurnResult> {
  const rounds: Round[] = [];
  const spoken: string[] = [];
  let nudge = false;
  for (let i = 0; i < MAX_ROUNDS; i++) {
    const nudged = nudge;
    nudge = false;
    const round: Round = { firstTokenMs: null, totalMs: 0, text: "", toolCalls: [], usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }, ...(nudged ? { nudged } : {}) };
    const calls: ToolCall[] = [];
    // The note is for this round only: it never stays in the call's history.
    const messages: ChatCompletionMessageParam[] = [{ role: "system", content: req.system }, ...req.messages, ...(nudged ? [{ role: "system" as const, content: DANGLING_NOTE }] : [])];
    // Each sentence goes to the voice as soon as Muse has written it, while the rest of the round streams.
    let unsaid = "";
    const sayDone = (all: boolean) => {
      for (let m = SENTENCE.exec(unsaid); m || (all && unsaid.trim()); m = SENTENCE.exec(unsaid)) {
        const sentence = (m ? m[1]! : unsaid).trim();
        unsaid = m ? unsaid.slice(m[0].length) : "";
        if (sentence) listener.say?.(sentence);
      }
    };
    for await (const ev of streamSpark(client, { model: req.model, reasoningEffort: req.reasoningEffort, messages, tools: req.toolbox.tools() })) {
      if (ev.type === "text") {
        round.text += ev.delta;
        unsaid += ev.delta;
        sayDone(false);
      } else if (ev.type === "toolCall") calls.push(ev.call);
      else Object.assign(round, { firstTokenMs: ev.firstTokenMs, totalMs: ev.totalMs, usage: ev.usage });
    }
    sayDone(true);
    round.text = round.text.trim();
    if (round.text) spoken.push(round.text);
    req.messages.push({
      role: "assistant",
      content: round.text,
      ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}),
    });
    for (const call of calls) {
      const started = performance.now();
      const result = req.toolbox.run(call);
      const done = { call, result, ms: performance.now() - started };
      round.toolCalls.push(done);
      listener.tool?.(done);
      req.messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
    rounds.push(round);
    if (calls.length) continue;
    // A first round that promised something and stopped: once more, told to call the tool or say nothing.
    if (i === 0 && round.text && !endsWithQuestion(round.text)) {
      nudge = true;
      continue;
    }
    break;
  }
  return { spoken: spoken.join(" "), rounds };
}

function endsWithQuestion(text: string): boolean {
  return /[?？;]\s*["'”»)]?\s*$/.test(text);
}
