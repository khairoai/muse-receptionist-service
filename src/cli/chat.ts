import { createInterface } from "node:readline/promises";
import { Calendar } from "../calendar.ts";
import { createSparkClient } from "../meta/muse-spark.ts";
import { Receptionist } from "../receptionist.ts";
import { metaApiKey, sparkModel } from "./env.ts";
import { printTurn } from "./print.ts";

/**
 * Talk to the receptionist by typing, as the caller: Muse Spark and the booking tools, no audio.
 *   pnpm chat
 * Write in Bulgarian or English; the call follows the script of your words.
 */
async function main(): Promise<void> {
  const receptionist = new Receptionist(createSparkClient(metaApiKey()), new Calendar(), { model: sparkModel() });
  console.log(`  agent › ${receptionist.greeting}`);
  // Piped (printf '…\n…\n' | pnpm chat): one line is one caller turn.
  if (!process.stdin.isTTY) {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    for (const line of input.split("\n").map((l) => l.trim()).filter(Boolean)) {
      console.log(`caller › ${line}`);
      printTurn(await receptionist.reply(line));
    }
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for (;;) {
    const line = (await rl.question("caller › ")).trim();
    if (line === "/quit") break;
    if (line) printTurn(await receptionist.reply(line));
  }
  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
