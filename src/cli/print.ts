import type { TurnResult } from "../receptionist.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const ms = (n: number | null) => (n === null ? "–" : `${Math.round(n)} ms`);

/** One receptionist turn: tool calls with their answers, then what is said, then the timings. */
export function printTurn(r: TurnResult): void {
  for (const [i, round] of r.rounds.entries()) {
    if (round.text && i < r.rounds.length - 1) console.log(`  agent › ${round.text}`);
    for (const t of round.toolCalls) {
      console.log(dim(`  ⚙ ${t.call.name}(${JSON.stringify(t.call.input)})`));
      console.log(dim(`    → ${JSON.stringify(t.result)}`));
    }
    if (i === r.rounds.length - 1 && round.text) console.log(`  agent › ${round.text}`);
    const u = round.usage;
    console.log(dim(`    muse-spark: first token ${ms(round.firstTokenMs)}, done ${ms(round.totalMs)}, ${u.inputTokens} in (${u.cachedInputTokens} cached), ${u.outputTokens} out (${u.reasoningTokens} reasoning)`));
  }
}
