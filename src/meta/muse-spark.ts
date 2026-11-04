import OpenAI from "openai";
import type { ChatCompletionChunk, ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

/**
 * Muse Spark on Meta's OpenAI-compatible Chat Completions endpoint (https://dev.meta.ai/docs/protocols/chat-completions),
 * streamed, with tools.
 *
 * What a phone call needs from it, and what we learned getting there (docs/benchmarks/muse-spark-for-voice.md):
 * - Muse Spark always reasons, and every reasoning token is silence on the line. `reasoning_effort: "minimal"` is the
 *   floor ("none" is a 400). On muse-spark-1.2 it gives 0.6–1.5 s to the first token; the default effort up to 3.6 s.
 * - The field is the top-level `reasoning_effort`. OpenRouter's `reasoning: { effort }` is refused:
 *   `400 unknown parameter 'reasoning'`.
 * - `tool_choice` accepts only "auto".
 * - The prompt cache works with no setup: from the second turn of a call most of the prompt is a cache read.
 */
export const MUSE_BASE_URL = "https://api.meta.ai/v1";
export const DEFAULT_MODEL = "muse-spark-1.2";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface SparkUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export type SparkEvent =
  | { type: "text"; delta: string }
  | { type: "toolCall"; call: ToolCall }
  | { type: "done"; usage: SparkUsage; finishReason: string; firstTokenMs: number | null; totalMs: number };

export interface SparkRequest {
  model?: string;
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
  signal?: AbortSignal;
}

export function createSparkClient(apiKey: string): OpenAI {
  // At most one retry and a 30 s timeout: the SDK's defaults (two retries, 10 minutes) are minutes of silence on a call.
  return new OpenAI({ apiKey, baseURL: MUSE_BASE_URL, maxRetries: 1, timeout: 30_000 });
}

/**
 * Yields text deltas as they arrive (so speech can start on the first sentence), then the tool calls, then one `done`
 * with the time to the first token (first text or tool-call delta) and the usage.
 */
export async function* streamSpark(client: OpenAI, req: SparkRequest): AsyncGenerator<SparkEvent> {
  const started = performance.now();
  const body: Record<string, unknown> = {
    model: req.model ?? DEFAULT_MODEL,
    messages: req.messages,
    stream: true,
    stream_options: { include_usage: true },
    // Reasoning tokens count toward max_tokens, even at "minimal" (10–1,083 per reply in our runs).
    max_tokens: req.maxTokens ?? 2048,
    reasoning_effort: req.reasoningEffort ?? "minimal",
  };
  if (req.tools?.length) {
    body.tools = req.tools;
    body.tool_choice = "auto";
  }
  const stream = (await client.chat.completions.create(body as never, { signal: req.signal })) as unknown as AsyncIterable<ChatCompletionChunk>;

  const pending = new Map<number, { id: string; name: string; args: string }>();
  let usage: ChatCompletionChunk["usage"] | undefined;
  let finishReason = "stop";
  let firstTokenMs: number | null = null;

  for await (const chunk of stream) {
    const choice = chunk.choices?.[0];
    const delta = choice?.delta;
    if (firstTokenMs === null && (delta?.content || delta?.tool_calls?.length)) firstTokenMs = performance.now() - started;
    if (delta?.content) yield { type: "text", delta: delta.content };
    for (const tc of delta?.tool_calls ?? []) {
      const slot = pending.get(tc.index) ?? { id: "", name: "", args: "" };
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name) slot.name += tc.function.name;
      if (tc.function?.arguments) slot.args += tc.function.arguments;
      pending.set(tc.index, slot);
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk.usage) usage = chunk.usage;
  }

  for (const [index, slot] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
    let input: Record<string, unknown>;
    try {
      input = slot.args.trim() ? (JSON.parse(slot.args) as Record<string, unknown>) : {};
    } catch {
      input = { _raw: slot.args, _parseError: true };
    }
    yield { type: "toolCall", call: { id: slot.id || `call_${index}`, name: slot.name, input } };
  }

  yield {
    type: "done",
    usage: {
      inputTokens: usage?.prompt_tokens ?? 0,
      cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    },
    finishReason,
    firstTokenMs,
    totalMs: performance.now() - started,
  };
}
