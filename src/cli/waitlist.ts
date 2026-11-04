import { createInterface } from "node:readline/promises";
import { addDays, BUSINESS, Calendar, serviceById, weekdayName, type Booking } from "../calendar.ts";
import { createSparkClient } from "../meta/muse-spark.ts";
import { Receptionist } from "../receptionist.ts";
import type { TurnResult } from "../turn.ts";
import { WaitlistRefill, type OfferCall } from "../waitlist.ts";
import { metaApiKey, sparkModel } from "./env.ts";
import { printTurn } from "./print.ts";
import { HANG_UP, SimulatedCaller } from "./simulated-caller.ts";

/**
 * Waitlist refill end to end, three calls on one calendar:
 *   1. Thomas wants an oil change tomorrow morning; the morning is full, so he joins the waitlist.
 *   2. Maria calls to cancel her oil change tomorrow morning.
 *   3. Khairo calls Thomas back, offers Maria's time and books it.
 * The customers are played by Muse Spark (shown as simulated), or by you with --you.
 *   pnpm waitlist [--you]
 */
const MAX_TURNS = 10;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

type Speaker = (agentLine: string) => Promise<string>;

async function main(): Promise<void> {
  const client = createSparkClient(metaApiKey());
  const model = sparkModel();
  const typing = process.argv.includes("--you");
  const rl = typing ? createInterface({ input: process.stdin, output: process.stdout }) : null;

  const calendar = new Calendar();
  const refill = new WaitlistRefill(client, calendar, { model });
  const day = nextOpenDay(calendar.today().date);
  const when = `${weekdayName(day)} ${day}`;
  const maria = fillMorning(calendar, day);

  console.log(bold(`${BUSINESS.name}, ${when}: the morning is fully booked`));
  printBoard(calendar, day);

  const person = (name: string, brief: string): Speaker => {
    if (rl) return async () => ((await rl.question(`${name} (you) › `)).trim() || HANG_UP);
    const caller = new SimulatedCaller(client, name, brief, { model });
    return (line) => caller.say(line);
  };

  console.log(bold(`\n☎  Call 1, inbound: Thomas Reed`));
  await inbound(
    new Receptionist(client, calendar, { model }),
    person("Thomas Reed", `You want an oil change on ${when}, in the morning: you need the car back by noon, so the afternoon or another day won't work. If they can't fit you in, you'd like them to call you if a morning time opens up.`),
  );

  console.log(bold(`\n☎  Call 2, inbound: Maria Lopez`));
  await inbound(
    new Receptionist(client, calendar, { model }),
    person("Maria Lopez", `You have an oil change booked on ${when} at ${maria.time}, and you need to cancel it: something came up at work. When they read it back, confirm.`),
  );

  for (const slot of refill.pending) console.log(dim(`\n  ⏸ ${slot.time} on ${slot.date} is free again: held for the waitlist (${calendar.waitlist().filter((e) => e.status === "waiting").length} waiting)`));

  const results = await refill.refill(async (call) => {
    console.log(bold(`\n☎  Call 3, outbound: Khairo calls ${call.offer.entry.name} back`));
    await outbound(call, person(call.offer.entry.name, `Earlier today you asked ${BUSINESS.name} to call you if a morning time opened on ${when} for an oil change. You still want one. Your phone is ringing and you pick up.`));
  });

  console.log(bold(`\n${BUSINESS.name}, ${when}, after the calls`));
  printBoard(calendar, day);
  for (const r of results) {
    const tried = r.calls.map((c) => `${c.entry.name}: ${c.outcome}`).join(", ") || "nobody was waiting";
    console.log(r.booking ? `\n  owner › ${r.slot.cancelled.name} cancelled ${r.slot.time}; Khairo rebooked it for ${r.booking.name} from the waitlist (${tried}).` : `\n  owner › ${r.slot.cancelled.name} cancelled ${r.slot.time}; not refilled (${tried}).`);
  }
  rl?.close();
}

/** An inbound call: the receptionist greets, then the caller and the receptionist take turns until the caller hangs up. */
async function inbound(receptionist: Receptionist, caller: Speaker): Promise<void> {
  console.log(`  agent › ${receptionist.greeting}`);
  let agentLine = receptionist.greeting;
  for (let i = 0; i < MAX_TURNS; i++) {
    const heard = await caller(agentLine);
    if (heard === HANG_UP) break;
    console.log(`caller › ${heard}`);
    const turn = await receptionist.reply(heard);
    printTurn(turn);
    agentLine = turn.spoken;
  }
  console.log(dim("  (hung up)"));
  receptionist.hangUp();
}

/** An outbound call: the agent asks for the person, then they take turns. */
async function outbound(call: OfferCall, person: Speaker): Promise<void> {
  console.log(`  agent › ${call.greeting}`);
  let heard = await person(call.greeting);
  for (let i = 0; i < MAX_TURNS && heard !== HANG_UP; i++) {
    console.log(`  them › ${heard}`);
    const turn: TurnResult = await call.reply(heard);
    printTurn(turn);
    heard = await person(turn.spoken);
  }
  console.log(dim(`  (hung up: ${call.outcome ?? "no answer"})`));
}

/** The next day the shop is open on a weekday, so the scenario has a whole morning to fill. */
function nextOpenDay(today: string): string {
  for (let d = 1; ; d++) {
    const date = addDays(today, d);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday >= 1 && weekday <= 5) return date;
  }
}

/** Books the morning full: Maria's oil change at the first time it fits, then other customers in every gap. */
function fillMorning(calendar: Calendar, day: string): Booking {
  const oil = serviceById("oil_change")!;
  const rotation = serviceById("tire_rotation")!;
  const first = calendar.freeStarts(oil, day, "morning")[0];
  const maria = first ? calendar.addBooking("Maria Lopez", oil.id, day, first) : null;
  if (!maria) throw new Error(`no morning time on ${day} to seed the demo`);
  const others = ["Kevin Wu", "Priya Shah", "Daniel Kim", "Grace Okafor", "Luis Romero", "Hannah Fischer", "Omar Haddad", "Emily Chen"];
  for (let i = 0; ; i++) {
    const free = calendar.freeStarts(rotation, day, "morning")[0];
    if (!free) break;
    calendar.addBooking(others[i % others.length]!, rotation.id, day, free);
  }
  return maria;
}

/** The morning, half-hour by half-hour (8:00–11:30). */
function printBoard(calendar: Calendar, day: string): void {
  let last: string | null = null;
  for (let t = 8 * 60; t < 12 * 60; t += 30) {
    const time = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
    const who = calendar.whoHas(day, time);
    const label = !who ? "free" : who === "other customer" ? "booked (another customer)" : `${who.service.name}, ${who.name}${who.source === "waitlist" ? "  ← from the waitlist" : ""}`;
    const key = typeof who === "object" && who ? who.id : label;
    console.log(dim(`  ${time}  ${key === last && who && who !== "other customer" ? "  ″" : label}`));
    last = key;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
