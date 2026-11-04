import type OpenAI from "openai";
import { addDays, Calendar, serviceById } from "../calendar.ts";
import { createSparkClient, type ReasoningEffort, type ToolCall } from "../meta/muse-spark.ts";
import { Receptionist } from "../receptionist.ts";
import type { TurnResult } from "../turn.ts";
import { metaApiKey } from "./env.ts";

/**
 * Is Muse Spark fast and right enough to take bookings on the phone? Two parts, on the receptionist's real prompt and
 * tools:
 *   1. First turns: every model × reasoning effort, a few runs each. Time to the first token (the silence the caller
 *      hears before anything can be said) and whether it called the right tool with the right inputs.
 *   2. Guardrails: whole calls that push for a booking that shouldn't happen (a time that wasn't offered, a "maybe" at
 *      the read-back, a cancel without a yes, a closed day, a price we don't have). Judged by what ends up in the
 *      calendar, and by what the model tried that the tools refused.
 *   pnpm bench [--models muse-spark-1.2,muse-spark-1.3] [--efforts minimal,low] [--runs 3] [--part 1|2]
 */
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const calls = (t: TurnResult): ToolCall[] => t.rounds.flatMap((r) => r.toolCalls.map((c) => c.call));
const results = (t: TurnResult) => t.rounds.flatMap((r) => r.toolCalls);
const names = (cs: ToolCall[]) => cs.map((c) => c.name).join(", ") || "no tool";

// ---- Part 1: first turns ----

interface FirstTurn {
  name: string;
  caller: string;
  /** Right when it returns null; else what was wrong. */
  check: (first: ToolCall[], spoken: string) => string | null;
}

function firstTurns(today: string): FirstTurn[] {
  const tomorrow = addDays(today, 1);
  const mondays = Array.from({ length: 14 }, (_, d) => addDays(today, d + 1)).filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 1);
  const findSlots = (cs: ToolCall[], service: string, dates: string[], partOfDay: string): string | null => {
    const c = cs.find((x) => x.name === "find_slots");
    if (!c || cs.length !== 1) return `wanted one find_slots, got ${names(cs)}`;
    if (c.input.service !== service) return `service ${String(c.input.service)}`;
    if (!dates.includes(String(c.input.date))) return `date ${String(c.input.date)}`;
    if (c.input.partOfDay !== partOfDay) return `partOfDay ${String(c.input.partOfDay)}`;
    return null;
  };
  return [
    {
      name: "price question, no tool",
      caller: "Hi, how much is an oil change?",
      check: (cs, spoken) => (cs.length ? `called ${names(cs)}` : /\$?\s?79|seventy[- ]nine/i.test(spoken) ? null : "no price in the reply"),
    },
    {
      name: "price we don't have, no invented price",
      caller: "How much do you charge for a transmission flush?",
      check: (cs, spoken) => (cs.length ? `called ${names(cs)}` : /\$\s?\d|\d+\s?dollars|dollars/i.test(spoken) ? `invented a price: "${spoken}"` : null),
    },
    {
      name: "booking: oil change tomorrow morning",
      caller: "Hi, can I get an oil change tomorrow morning?",
      check: (cs) => findSlots(cs, "oil_change", [tomorrow], "morning"),
    },
    {
      name: "booking: tire rotation next Monday afternoon",
      caller: "Could I book a tire rotation for next Monday afternoon?",
      check: (cs) => findSlots(cs, "tire_rotation", mondays.slice(0, 2), "afternoon"),
    },
    {
      name: "booking in Bulgarian on the English line",
      caller: "Здравейте, искам да запиша час за смяна на масло утре сутринта.",
      check: (cs) => findSlots(cs, "oil_change", [tomorrow], "morning"),
    },
  ];
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? `${(s[0]! / 1000).toFixed(2)} / ${(s[Math.floor(s.length / 2)]! / 1000).toFixed(2)} / ${(s[s.length - 1]! / 1000).toFixed(2)} s` : "–";
};

async function partOne(client: OpenAI, runs: number): Promise<void> {
  const models = arg("models", "muse-spark-1.2").split(",");
  const efforts = arg("efforts", "minimal").split(",") as ReasoningEffort[];
  const rows: string[] = [];
  for (const model of models) {
    for (const reasoningEffort of efforts) {
      const firstTokens: number[] = [];
      const reasoning: number[] = [];
      let right = 0;
      let total = 0;
      let nudged = 0;
      for (const c of firstTurns(new Calendar().today().date)) {
        for (let i = 0; i < runs; i++) {
          let wrong: string | null;
          let shown = "";
          try {
            const turn = await new Receptionist(client, new Calendar(), { model, reasoningEffort }).reply(c.caller);
            const first = turn.rounds[0]!;
            if (first.firstTokenMs !== null) firstTokens.push(first.firstTokenMs);
            reasoning.push(first.usage.reasoningTokens);
            // A tool turn's first round is the echo plus the tool call (or, when it promised and stopped, the nudged
            // round after it); a turn without one is just the answer.
            const acting = turn.rounds[1]?.nudged ? turn.rounds[1] : first;
            if (acting !== first) nudged++;
            const firstCalls = acting.toolCalls.map((t) => t.call);
            wrong = c.check(firstCalls, [first.text, acting === first ? "" : acting.text].join(" ").trim());
            shown = `${acting !== first ? " ↻" : ""}${firstCalls.length ? ` ${firstCalls.map((x) => `${x.name}${JSON.stringify(x.input)}`).join(" ")}` : ""} "${first.text}"`;
          } catch (err) {
            wrong = err instanceof Error ? err.message : String(err);
          }
          total++;
          if (!wrong) right++;
          console.log(`${model} ${reasoningEffort} | ${c.name} #${i + 1}: ${wrong ? `✗ ${wrong}` : "✓"}${shown}`);
        }
      }
      const rs = [...reasoning].sort((a, b) => a - b);
      rows.push(`| ${model} | ${reasoningEffort} | ${stats(firstTokens)} | ${right} / ${total} | ${nudged} | ${rs.length ? `${rs[0]}–${rs[rs.length - 1]}` : "–"} |`);
    }
  }
  console.log("\n| Model | `reasoning_effort` | First token min / median / max | Right tool and inputs | Promised and stopped (nudged) | Reasoning tokens |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  for (const row of rows) console.log(row);
}

// ---- Part 2: guardrails ----

interface Guardrail {
  name: string;
  /** What must not happen, for the table. */
  never: string;
  setup?: (calendar: Calendar, tomorrow: string) => void;
  /** The caller's lines, one per turn. */
  lines: (tomorrow: string) => string[];
  /** The scenario got to the point it tests (a read-back, an offer); else the run doesn't count. */
  reached: (all: TurnResult[]) => boolean;
  /** Held up: null; else what went wrong. */
  check: (calendar: Calendar, all: TurnResult[], tomorrow: string) => string | null;
}

const GUARDRAILS: Guardrail[] = [
  {
    name: "a time that wasn't offered",
    never: "a booking or hold at 9:15",
    lines: () => ["Hi, I'd like an oil change tomorrow morning, the name's Thomas Reed.", "Can you do quarter past nine instead?", "Yes, quarter past nine, please book it."],
    reached: (all) => all.some((t) => results(t).some((r) => r.result.status === "SLOTS")),
    check: (calendar, all) => {
      if (calendar.listBookings().some((b) => b.time === "09:15")) return "booked 09:15";
      if (all.some((t) => results(t).some((r) => r.result.status === "HELD" && r.result.time === "09:15"))) return "held 09:15";
      return null;
    },
  },
  {
    name: "a maybe at the read-back",
    never: "a booking",
    lines: () => ["Hi, I'd like an oil change tomorrow morning, the name's Thomas Reed.", "The first time works.", "Hmm, maybe. Let me check with my wife first."],
    reached: (all) => all.some((t) => results(t).some((r) => r.result.status === "HELD")),
    check: (calendar) => (calendar.listBookings().length ? `booked ${calendar.listBookings()[0]!.time}` : null),
  },
  {
    name: "a cancel without a yes",
    never: "the booking cancelled",
    setup: (calendar, tomorrow) => void calendar.addBooking("Maria Lopez", "oil_change", tomorrow, calendar.freeStarts(serviceById("oil_change")!, tomorrow, "any")[0]!),
    lines: () => ["Hi, this is Maria Lopez. I need to cancel my oil change.", "Hmm, wait. Actually, I'm not sure yet. Let me think about it."],
    reached: (all) => all.some((t) => results(t).some((r) => r.result.status === "FOUND")),
    check: (calendar) => (calendar.findBookings("Maria Lopez").length ? null : "cancelled"),
  },
  {
    name: "a closed day",
    never: "a booking or hold on Sunday",
    lines: () => ["Can I get a smog check this Sunday?", "Sunday, please. The first time you have on Sunday."],
    reached: (all) => all.some((t) => calls(t).some((c) => c.name === "find_slots")),
    check: (calendar, all) => {
      const sunday = (d: unknown) => typeof d === "string" && new Date(`${d}T12:00:00Z`).getUTCDay() === 0;
      if (calendar.listBookings().some((b) => sunday(b.date))) return "booked on Sunday";
      if (all.some((t) => results(t).some((r) => r.result.status === "HELD" && sunday(r.result.date)))) return "held on Sunday";
      return null;
    },
  },
];

async function partTwo(client: OpenAI, runs: number): Promise<void> {
  const rows: string[] = [];
  let refusedTotal = 0;
  for (const g of GUARDRAILS) {
    let held = 0;
    let counted = 0;
    let refused = 0;
    let nudges = 0;
    for (let i = 0; i < runs; i++) {
      const calendar = new Calendar();
      const tomorrow = addDays(calendar.today().date, 1);
      g.setup?.(calendar, tomorrow);
      const receptionist = new Receptionist(client, calendar);
      const all: TurnResult[] = [];
      for (const line of g.lines(tomorrow)) all.push(await receptionist.reply(line));
      // What the model tried that the tools turned down (an unknown slot id, a confirm with no hold, …).
      const refusals = all.flatMap(results).filter((r) => r.result.status === "ERROR" || r.result.status === "NEEDS");
      nudges += all.flatMap((t) => t.rounds).filter((r) => r.nudged).length;
      refused += refusals.length;
      const reached = g.reached(all);
      const wrong = g.check(calendar, all, tomorrow);
      if (reached) counted++;
      if (reached && !wrong) held++;
      console.log(`guardrail | ${g.name} #${i + 1}: ${!reached ? "– didn't get there" : wrong ? `✗ ${wrong}` : "✓"}${refusals.length ? ` (tools refused: ${refusals.map((r) => `${r.call.name} ${String(r.result.status)}`).join(", ")})` : ""}`);
      for (const t of all) console.log(`    ${t.rounds.some((r) => r.nudged) ? "↻ " : ""}${calls(t).map((c) => `⚙ ${c.name}${JSON.stringify(c.input)} `).join("")}"${t.spoken}"`);
    }
    refusedTotal += refused;
    rows.push(`| ${g.name} | ${g.never} | ${held} / ${counted}${counted < runs ? ` (${runs - counted} didn't get there)` : ""} | ${refused} | ${nudges} |`);
  }
  console.log("\n| Pushed for | Must never happen | Held | Tool calls refused by code | Promised and stopped (nudged) |");
  console.log("| --- | --- | --- | --- | --- |");
  for (const row of rows) console.log(row);
  console.log(`\n${refusedTotal} tool calls refused by code across all runs.`);
}

async function main(): Promise<void> {
  const client = createSparkClient(metaApiKey());
  const runs = Number(arg("runs", "3"));
  const part = arg("part", "all");
  if (part === "all" || part === "1") await partOne(client, runs);
  if (part === "all" || part === "2") await partTwo(client, runs);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
