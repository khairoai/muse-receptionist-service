# Muse Spark as a phone receptionist's brain

_Is Muse Spark fast enough to talk on the phone, and does it call the booking tools right? Re-run it yourself with
`pnpm bench:spark`._

## The bar

On a call, the time to the model's first token is silence the caller hears, on top of the speech-to-text's end of turn
and the text-to-speech's first audio. And a
receptionist that books has to pick the right tool with the right inputs every time: a wrong date is a wrong booking.

## 2026-11-04: this repo's benchmark

`pnpm bench:spark --models muse-spark-1.2,muse-spark-1.3 --efforts minimal,low --runs 3`: the receptionist's real prompt
and tools, three first caller turns (a Bulgarian price question that needs no tool, a Bulgarian booking for "утре
сутринта" (tomorrow morning), an English booking for "next Monday afternoon"), 3 runs each, from a laptop in Bulgaria.

| Model | `reasoning_effort` | First token min / median / max | Right tool and inputs | Reasoning tokens |
| --- | --- | --- | --- | --- |
| **muse-spark-1.2** | **minimal** | **0.36 / 0.80 / 0.95 s** | **9 / 9** | 19–39 |
| muse-spark-1.2 | low | 0.50 / 0.56 / 1.26 s | 9 / 9 | 26–112 |
| muse-spark-1.3 | minimal | 1.00 / 1.24 / 1.56 s | 9 / 9 | 15–98 |
| muse-spark-1.3 | low | 1.08 / 1.58 / 3.91 s | 9 / 9 | 37–285 |

**36 of 36** right: it resolves relative dates against today in the prompt ("утре" → the next day's ISO date, "next
Monday" → the coming Monday), maps the caller's words to the catalog's service ids, and answers a price question from
the prompt without a tool, saying the number as words ("шестдесет евро").

## 2026-11-02: the first evaluation

54 streamed requests with a two-tool Bulgarian car-service prompt, `muse-spark-1.3`, `1.3-contributor` and `1.2` at
minimal / low / default effort:

| Model | minimal | low | default |
| --- | --- | --- | --- |
| muse-spark-1.2 | **0.57–1.5 s** | 0.9–1.6 s | 0.8–3.6 s |
| muse-spark-1.3 | 2.4–8.7 s | 1.3–6.4 s | 2.4–23.5 s |
| muse-spark-1.3-contributor | 1.5–5.1 s | 1.9–6.6 s | 2.4–10.6 s |

Tool calls: 36 / 36 right. That made `muse-spark-1.2` at `minimal` our choice. We don't use Contributor mode: Meta may
train on what it's sent, and callers say their names and phone numbers.

## In production since 2026-11-03

Every published receptionist runs on `muse-spark-1.2`. On a real call (11 turns, Bulgarian, Muse Voice Transcribe for
speech-to-text), the caller-stops → agent-speaks gap was **p50 1.68 s, p95 2.61 s**: plain turns p50 1.5 s, turns with a
tool call 2.3 s. Muse streams the reply in fast bursts (about 40 characters in ~40 ms), so we can wait for a whole first
sentence before speaking, which removed mid-sentence pauses in the voice.

## What we had to learn

- **It always reasons.** `reasoning_effort: "none"` is a 400. `minimal` still produces 5–100 reasoning tokens, and they
  count toward `max_tokens`, so don't set it tight.
- **The parameter is `reasoning_effort`.** Our OpenRouter-style `reasoning: { effort }` got `400 unknown parameter`.
- **`tool_choice` takes only `"auto"`.** So Muse can't run our build-time stages, which force exactly one tool call. On
  the phone, "auto" is what we want anyway.
- **The prompt cache is automatic.** From the second request of a call, 1,265–1,777 of ~1,400–2,000 input tokens are
  cache reads, with no setup.
- **It narrates before tools** ("Let me check what we have…") despite the prompt asking it not to. On the phone this
  fills the silence during the tool call, so we let it.
- **Without a fact, it invents one.** With no opening hours in the prompt, every model made them up. Everything the
  receptionist may say is in the prompt or comes from a tool.
