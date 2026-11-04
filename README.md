# Khairo Receptionist on Meta Muse

**A phone receptionist that answers a small business's calls and books the appointment, built on Meta's Muse Voice
Transcribe and Muse Spark.**

> **Try it live:** talk to it in your browser at **[khairo.ai/demo](https://khairo.ai/demo)**, or call
> **+1 (415) 873-5520**. It's the receptionist of _Golden Gate Auto Care_, a demo car service: ask about prices and
> hours, then book an appointment.

Owner-run businesses (car services, dentists, salons) still take bookings by phone, and the owner can't pick up mid-job.
A missed call goes to the next business on the list. Khairo answers on the business's own number and books into its
calendar. This repo is its voice core, built for the
[Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon) (Startup track, _Build for
Your World_).

| The live demo | A booking from a demo call, in the business's calendar |
| --- | --- |
| ![khairo.ai/demo: talk to the receptionist in the browser](docs/images/demo-page.png) | ![The Khairo dashboard calendar with a booking made by the receptionist](docs/images/dashboard-calendar.png) |

## What we built during the hackathon (Oct 27 – Nov 4)

Khairo existed before the hackathon. This is what we built during it; everything in this repo was written in that
time.

| Date | Built | Where |
| --- | --- | --- |
| Nov 2–3 | **Muse Spark as the receptionist's brain.** The streaming client with tools and `reasoning_effort`, an evaluation of Muse Spark 1.2 and 1.3 at three effort levels (right tool and inputs in 36 of 36 tries), then every live receptionist moved onto it | [`src/meta/muse-spark.ts`](src/meta/muse-spark.ts), production |
| Nov 2–4 | **Following the caller's language with Muse Voice Transcribe's code-switching.** English speech on a stream biased to Bulgarian comes back as English words, so the call switches language from the caller's first sentence without reopening the stream | production (this repo's demo is English only) |
| Nov 4 | **Turns that don't wait in silence.** Muse Spark echoes the caller's request while a tool runs; in production, Meta's Llama 3.3 writes a two-word acknowledgement in parallel when Muse Spark goes straight to a tool. Also: one question per turn, two offered times, today's date in context, and hanging up on a silent line | [`src/receptionist.ts`](src/receptionist.ts), production |
| Nov 4 | **The English receptionist and its live demo:** [khairo.ai/demo](https://khairo.ai/demo) in the browser and the +1 (415) 873-5520 line | production |
| Nov 4 | **This repo:** the Muse clients on their own, the demo receptionist and calendar, the browser demo, and the `call` and `chat` tools | everything here |

**Before the hackathon** (the existing Khairo platform, not part of this entry): the telephony, the bookings engine
and the dashboard, the ElevenLabs voice, and the Muse Voice Transcribe integration in our production voice service. We
added that integration on Oct 25, the evening before kickoff, after it beat Deepgram Nova-3 on our real Bulgarian calls
(20% vs 30% word errors, end of turn in ~0.4 s instead of up to 7 s), which is why the receptionist hears with Muse.

## Where Meta's models are used

| Model | Where | What it does |
| --- | --- | --- |
| **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`, realtime WebSocket) | [`src/meta/muse-transcribe.ts`](src/meta/muse-transcribe.ts) | Streams the caller's audio, returns the text and decides when the caller's turn has ended |
| **Muse Spark 1.2** (Chat Completions, streamed, with tools) | [`src/meta/muse-spark.ts`](src/meta/muse-spark.ts), [`src/receptionist.ts`](src/receptionist.ts) | Talks to the caller and books through `find_slots` → `hold_slot` → `confirm_booking` |

- **The calendar decides, not the model.** Muse Spark can only offer slots `find_slots` returned, and books only after
  reading the name, day and time back and hearing a clear yes.
- **No silence during tool calls.** Muse Spark starts each tool turn with a short echo of the request ("A brake
  inspection tomorrow afternoon, I'll check what we have."), which is spoken while the tool runs.

## Run it

You need Node 22+, pnpm and a [Meta Model API key](https://dev.meta.ai). For the browser demo, also an
[ElevenLabs](https://elevenlabs.io) key and voice: Meta has no text-to-speech model, so the receptionist's voice is
ElevenLabs Eleven v4, as on our live lines.

```bash
pnpm install
cp .env.example .env                   # add META_MODEL_API_KEY (and the ElevenLabs keys for the demo)

pnpm demo                              # the khairo.ai/demo page on this pipeline: http://localhost:3000
pnpm call samples/oil-change/*.wav     # a recorded caller: audio → Muse Voice Transcribe → Muse Spark → booking
pnpm chat                              # be the caller: type your lines
```

`pnpm demo` is the same call as [khairo.ai/demo](https://khairo.ai/demo): talk into your microphone, and the page
shows what Muse heard, every tool call and the timing of each step.

`pnpm call` streams each WAV as one caller turn, at real time in 20 ms frames like a phone line. It prints what Muse
heard, every tool call and its answer, what the receptionist says, and the timing of each turn. Any 16-bit PCM WAV
works, one file per caller turn. The sample callers are synthetic voices, not real customers.

## In production

Both models answer Khairo's live phone lines, including the demo line above. From the caller's last word to the
receptionist's voice: **1.5–1.6 s at the median** on our latest calls (1.9 s before the work above), through
telephony, at about 5¢ a minute.

![Production call analytics](docs/images/production-analytics.png)

## What's in this repo

| Path | What |
| --- | --- |
| [`src/meta/`](src/meta) | The Muse Voice Transcribe and Muse Spark clients |
| [`src/receptionist.ts`](src/receptionist.ts) | The receptionist: prompt and tool loop |
| [`src/calendar.ts`](src/calendar.ts) | A demo car service and its calendar behind the three booking tools |
| [`src/demo/`](src/demo) | The browser demo: the page and its server |
| [`src/tts/`](src/tts) | The ElevenLabs voice |
| [`src/cli/`](src/cli) | `call` (WAV → full pipeline) and `chat` (text) |
| [`samples/`](samples) | Synthetic caller turns |

## License and team

Open source under the [Apache License 2.0](LICENSE). Copyright 2026 Khairo.

[Khairo](https://khairo.ai): Vladislav Varadinov and Kristiyan, Sofia.
