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

## Where Meta's models are used

| Model | Where | What it does |
| --- | --- | --- |
| **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`, realtime WebSocket) | [`src/meta/muse-transcribe.ts`](src/meta/muse-transcribe.ts) | Streams the caller's audio, returns the text and decides when the caller's turn has ended |
| **Muse Spark 1.2** (Chat Completions, streamed, with tools) | [`src/meta/muse-spark.ts`](src/meta/muse-spark.ts), [`src/receptionist.ts`](src/receptionist.ts) | Talks to the caller and books through `find_slots` → `hold_slot` → `confirm_booking` |

- **The calendar decides, not the model.** Muse Spark can only offer slots `find_slots` returned, and books only after
  reading the name, day and time back and hearing a clear yes.
- **No silence during tool calls.** Muse Spark starts each tool turn with a short echo of the request ("A brake
  inspection tomorrow afternoon, I'll check what we have."), which is spoken while the tool runs.
- **The call follows the caller's language.** Muse Voice Transcribe code-switches, so the receptionist switches language
  from the caller's first sentence without reopening the stream ([`src/language.ts`](src/language.ts)).

## Run it

You need Node 22+, pnpm and a [Meta Model API key](https://dev.meta.ai).

```bash
pnpm install
cp .env.example .env                     # add META_MODEL_API_KEY

pnpm call samples/en-tyre-change/*.wav   # a recorded caller: audio → Muse Voice Transcribe → Muse Spark → booking
pnpm chat                                # be the caller: type your lines
```

`pnpm call` streams each WAV as one caller turn, at real time in 20 ms frames like a phone line. It prints what Muse
heard, every tool call and its answer, what the receptionist says, and the timing of each turn. Any 16-bit PCM WAV
works, one file per caller turn. The sample callers are synthetic voices, not real customers.

## In production

Both models answer Khairo's live phone lines, including the demo line above. From the caller's last word to the
receptionist's voice: **1.86 s at the median**, through telephony, at about 5¢ a minute.

![Production call analytics](docs/images/production-analytics.png)

## What's in this repo

| Path | What |
| --- | --- |
| [`src/meta/`](src/meta) | The Muse Voice Transcribe and Muse Spark clients |
| [`src/receptionist.ts`](src/receptionist.ts) | The receptionist: prompt, tool loop, language following |
| [`src/calendar.ts`](src/calendar.ts) | A demo car service and its calendar behind the three booking tools |
| [`src/cli/`](src/cli) | `call` (WAV → full pipeline) and `chat` (text) |
| [`samples/`](samples) | Synthetic caller turns |

## License and team

Source-available under the [Khairo Source-Available License](LICENSE): free to read, run and modify to evaluate or
judge it.

[Khairo](https://khairo.ai): Vladislav Varadinov and Kristiyan, Sofia.
