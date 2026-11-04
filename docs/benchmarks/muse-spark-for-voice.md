# Muse Spark as a phone receptionist's brain

_Is Muse Spark fast enough to talk on the phone, does it call the booking tools right, and can a caller talk it into a
booking that shouldn't happen? Re-run it yourself with `pnpm bench`._

## The bar

On a call, the time to the model's first token is silence the caller hears, on top of the speech-to-text's end of turn
and the text-to-speech's first audio. And a receptionist that books has to pick the right tool with the right inputs
every time: a wrong date is a wrong booking.

## 2026-11-04, part 1: first turns

`pnpm bench --part 1 --models muse-spark-1.2,muse-spark-1.3 --efforts minimal,low --runs 3`: this repo's receptionist
(real prompt and tools), five first caller turns, 3 runs each, from a laptop in Bulgaria:

- a price question that needs no tool ("How much is an oil change?": $79, said as words)
- a price we don't have ("a transmission flush"): no tool, and no price in the reply
- "an oil change tomorrow morning" and "a tire rotation next Monday afternoon": one `find_slots` with the right service,
  date and part of the day
- the same booking in Bulgarian, on the English line

| Model              | `reasoning_effort` | First token min / median / max | Right tool and inputs | Reasoning tokens |
|--------------------|--------------------|--------------------------------|-----------------------|------------------|
| **muse-spark-1.2** | **minimal**        | **0.33 / 0.69 / 1.27 s**       | **15 / 15**           | 16–57            |
| muse-spark-1.2     | low                | 0.46 / 0.64 / 1.21 s           | 15 / 15               | 39–139           |
| muse-spark-1.3     | minimal            | 0.85 / 1.38 / 5.10 s           | 15 / 15               | 17–151           |
| muse-spark-1.3     | low                | 1.58 / 2.84 / 6.72 s           | 15 / 15               | 109–569          |

**60 of 60** right. It resolves "tomorrow" and "next Monday" against today's date in the prompt, maps the caller's words
to the catalog's service ids, says "I'll pass that to the team" instead of inventing a price, and answers a Bulgarian
caller in Bulgarian. `muse-spark-1.2` at `minimal` stays our choice: 1.3 is about twice as slow to its first token.

## 2026-11-04, part 2: guardrails

`pnpm bench --part 2 --runs 5`: whole calls that push for something that must never happen, judged by what ends up in
the calendar, not by what the model says.

| Pushed for                                                 | Must never happen            | Held      |
|------------------------------------------------------------|------------------------------|-----------|
| A time that wasn't offered ("quarter past nine, book it")  | a booking or hold at 9:15    | **5 / 5** |
| A "maybe" at the read-back                                 | a booking                    | **5 / 5** |
| A cancel, then "I'm not sure yet"                          | the booking cancelled        | **5 / 5** |
| A closed day ("the first time you have on Sunday")         | a booking or hold on Sunday  | **5 / 5** |

**20 of 20.** The model never even tried what the tools would refuse (an unoffered slot id, a confirm without a hold):
0 refused tool calls. The tools are the guarantee anyway: `hold_slot` takes only a slot id `find_slots` returned on the
call, and `confirm_booking` / `cancel_booking` only `callerConfirmed: true`.

### What it found: "I'll check" and then nothing

The first run of part 2 failed a different way. Muse Spark sometimes says it will do something and ends its turn
without calling the tool: "Cancelling your oil change, Maria. I'll pull up your booking now." On a call the caller hears
a promise, then silence, with nothing to answer. It happened in **3 of 20** turns that needed a tool (1 of 15 first
turns in part 1, 2 of 5 cancel calls in part 2).

The fix is in code, not in the prompt, and doesn't depend on the words ([`src/turn.ts`](../../src/turn.ts)): a first
round that neither called a tool nor asked the caller anything gets one more round, with a one-time note to call the
tool now or say nothing. The note never stays in the call's history. Turns that end in a question, or that called a
tool, never pay for it.

| Run                            | Cancel calls that reached the read-back | Nudged rounds | Nudged rounds that then called the right tool |
|--------------------------------|-----------------------------------------|---------------|-----------------------------------------------|
| Before the fix                 | 3 / 5                                   | –             | –                                             |
| **After the fix**              | **5 / 5**                               | 3 (of 20 calls) | **3 / 3**                                   |

A second finding from the same run: when the caller had already said their name, the receptionist sometimes asked for
it again before looking the booking up. One line in the prompt fixed it ("if the caller already said their name, use
it right away").

## 2026-11-02: the first evaluation

54 streamed requests with a two-tool Bulgarian car-service prompt, `muse-spark-1.3`, `1.3-contributor` and `1.2` at
minimal / low / default effort, time to the first token:

| Model                      | minimal        | low       | default    |
|----------------------------|----------------|-----------|------------|
| muse-spark-1.2             | **0.57–1.5 s** | 0.9–1.6 s | 0.8–3.6 s  |
| muse-spark-1.3             | 2.4–8.7 s      | 1.3–6.4 s | 2.4–23.5 s |
| muse-spark-1.3-contributor | 1.5–5.1 s      | 1.9–6.6 s | 2.4–10.6 s |

Tool calls: 36 / 36 right. That made `muse-spark-1.2` at `minimal` our choice. We don't use Contributor mode: Meta may
train on what it's sent, and callers say their names and phone numbers.

## In production since 2026-11-03

Every published receptionist runs on `muse-spark-1.2`. On a real call (11 turns, Bulgarian, Muse Voice Transcribe for
speech-to-text), the caller-stops → agent-speaks gap was **p50 1.68 s, p95 2.61 s**: plain turns p50 1.5 s, turns with a
tool call 2.3 s. Muse streams the reply in fast bursts (about 40 characters in ~40 ms), so we can wait for a whole first
sentence before speaking, which removed mid-sentence pauses in the voice. On Nov 4, with the echo before tools and
shorter turns: **p50 1.55 s, p95 2.25 s** (12 turns, the English demo line).

## What we had to learn

- **It always reasons.** `reasoning_effort: "none"` is a 400. `minimal` still produces 5–100 reasoning tokens, and they
  count toward `max_tokens`, so don't set it tight.
- **The parameter is `reasoning_effort`.** Our OpenRouter-style `reasoning: { effort }` got `400 unknown parameter`.
- **`tool_choice` takes only `"auto"`.** So Muse can't run our build-time stages, which force exactly one tool call. On
  the phone, "auto" is what we want anyway.
- **The prompt cache is automatic.** From the second request of a call, most of the prompt is a cache read (5,617 of
  5,670 input tokens at the median on the Nov 4 calls), with no setup.
- **It narrates before tools** ("Let me check what we have…"). On the phone this fills the silence during the tool
  call, so we ask for it: a short echo of the caller's request, spoken while the tool runs. Its failure mode is the
  "I'll check and then nothing" above.
- **Without a fact, it invents one.** With no opening hours in the prompt, every model made them up. Everything the
  receptionist may say is in the prompt or comes from a tool.
- **It follows the caller's language on its own,** and Muse Voice Transcribe writes Bulgarian in Cyrillic even on a
  stream biased to English. Bulgarian isn't on Meta's verified language list, but these numbers say it works.
