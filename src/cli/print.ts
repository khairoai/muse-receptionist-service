import type { TurnResult } from "../turn.ts";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const ms = (n: number | null) => (n === null ? "–" : `${Math.round(n)} ms`);

/** One receptionist turn: tool calls with their answers, then what is said, then the timings. */
export function printTurn(r: TurnResult & { switchedLanguage?: boolean; language?: string }): void {
  if (r.switchedLanguage) console.log(dim(`  ↔ language: the caller is speaking ${r.language === "bg" ? "Bulgarian" : "English"}, the call follows (same Muse stream)`));
  for (const [i, round] of r.rounds.entries()) {
    if (round.nudged) console.log(dim("  ↻ the last round promised something and stopped: once more, told to call the tool or say nothing"));
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
