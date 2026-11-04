import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { Calendar } from "../calendar.ts";
import { createSparkClient, streamSpark, type ReasoningEffort, type ToolCall } from "../meta/muse-spark.ts";
import { GREETING, Receptionist } from "../receptionist.ts";
import { metaApiKey } from "./env.ts";

/**
 * Is Muse Spark fast and right enough for a phone call? The receptionist's real prompt and tools, three first caller
 * turns, every model × reasoning effort, a few runs each: time to the first token (first text or tool-call delta: the
 * silence the caller hears before anything can be said) and whether it called the right tool with the right inputs.
 *   pnpm bench:spark [--models muse-spark-1.2,muse-spark-1.3] [--efforts minimal,low] [--runs 3]
 */
interface Case {
  name: string;
  caller: string;
  language: "bg" | "en";
  /** Right when it returns null; else what was wrong. */
  check: (calls: ToolCall[], text: string) => string | null;
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

function cases(today: string): Case[] {
  const tomorrow = shift(today, 1);
  const mondays = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((d) => shift(today, d)).filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 1);
  const findSlots = (calls: ToolCall[], service: string, dates: string[], partOfDay: string): string | null => {
    const c = calls.find((x) => x.name === "find_slots");
    if (!c || calls.length !== 1) return `wanted one find_slots, got ${calls.map((x) => x.name).join(", ") || "no tool"}`;
    if (c.input.service !== service) return `service ${String(c.input.service)}`;
    if (!dates.includes(String(c.input.date))) return `date ${String(c.input.date)}`;
    if (c.input.partOfDay !== partOfDay) return `partOfDay ${String(c.input.partOfDay)}`;
    return null;
  };
  return [
    {
      name: "price question (bg), no tool",
      caller: "Колко струва смяната на масло?",
      language: "bg",
      // Spoken replies say numbers as words: "шестдесет евро".
      check: (calls, text) => (calls.length ? `called ${calls.map((x) => x.name).join(", ")}` : /60|шестдесет|sixty/i.test(text) ? null : "no price in the reply"),
    },
    {
      name: "booking (bg): oil change tomorrow morning",
      caller: "Здравейте, искам да запиша смяна на масло за утре сутринта.",
      language: "bg",
      check: (calls) => findSlots(calls, "oil_change", [tomorrow], "morning"),
    },
    {
      name: "booking (en): tyre change next Monday afternoon",
      caller: "Hi, can I book a tyre change for next Monday afternoon?",
      language: "en",
      check: (calls) => findSlots(calls, "tyre_change", mondays.slice(0, 2), "afternoon"),
    },
  ];
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? `${(s[0]! / 1000).toFixed(2)} / ${(s[Math.floor(s.length / 2)]! / 1000).toFixed(2)} / ${(s[s.length - 1]! / 1000).toFixed(2)} s` : "–";
};

async function main(): Promise<void> {
  const client = createSparkClient(metaApiKey());
  const models = arg("models", "muse-spark-1.2").split(",");
  const efforts = arg("efforts", "minimal").split(",") as ReasoningEffort[];
  const runs = Number(arg("runs", "3"));
  const calendar = new Calendar();
  const tools = calendar.tools();
  const all = cases(calendar.today().date);

  const rows: string[] = [];
  for (const model of models) {
    for (const effort of efforts) {
      const firstTokens: number[] = [];
      const reasoning: number[] = [];
      let right = 0;
      let total = 0;
      for (const c of all) {
        // The prompt the receptionist sends on this caller's first turn, language already switched.
        const r = new Receptionist(client, calendar, { language: c.language });
        const messages: ChatCompletionMessageParam[] = [
          { role: "system", content: r.systemPrompt() },
          { role: "assistant", content: GREETING[c.language] },
          { role: "user", content: c.caller },
        ];
        for (let i = 0; i < runs; i++) {
          const calls: ToolCall[] = [];
          let text = "";
          let wrong: string | null = "no answer";
          try {
            for await (const ev of streamSpark(client, { model, messages, tools, reasoningEffort: effort })) {
              if (ev.type === "text") text += ev.delta;
              else if (ev.type === "toolCall") calls.push(ev.call);
              else {
                if (ev.firstTokenMs !== null) firstTokens.push(ev.firstTokenMs);
                reasoning.push(ev.usage.reasoningTokens);
                wrong = c.check(calls, text);
              }
            }
          } catch (err) {
            wrong = err instanceof Error ? err.message : String(err);
          }
          total++;
          if (!wrong) right++;
          console.log(`${model} ${effort} | ${c.name} #${i + 1}: ${wrong ? `✗ ${wrong}` : "✓"}${calls.length ? ` ${calls.map((x) => `${x.name}${JSON.stringify(x.input)}`).join(" ")}` : ""}${text ? ` "${text.trim()}"` : ""}`);
        }
      }
      const rs = [...reasoning].sort((a, b) => a - b);
      rows.push(`| ${model} | ${effort} | ${stats(firstTokens)} | ${right}/${total} | ${rs.length ? `${rs[0]}–${rs[rs.length - 1]}` : "–"} |`);
    }
  }
  console.log("\n| model | reasoning_effort | first token min / median / max | right tool and inputs | reasoning tokens |");
  console.log("|---|---|---|---|---|");
  for (const row of rows) console.log(row);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
