# Muse Voice Transcribe vs Deepgram Nova-3 on real Bulgarian phone calls

_Measured 2026-10-25 on our production server (Hetzner, Germany). This is what made us move every live receptionist to
Muse Voice Transcribe._

## Why it matters

On the phone, the caller's turn ends when the speech-to-text says so. Every millisecond after the caller's last word is
silence they hear, and every misheard word ("час", an appointment, heard as "чат", a chat) can break a booking. Before this
test, our callers waited **up to 6.9 s** on some turns for Deepgram's final transcript, on a silent line.

## Setup

- **Audio:** the caller channel of every call recorded on our server at the time: 5 calls, 536 s, made by the team to a
  hair-salon test line from mobile phones. Real phone audio, real Bulgarian, recordings not published.
- **How:** each call streamed at real-time pace in 20 ms frames (as our telephony provider delivers it), plus 3 s of
  silence, through our production provider classes, so we measured what a live call gets:
  - Deepgram `nova-3`, EU region, production settings (endpointing 300 ms, utterance end 1000 ms)
  - Meta `muse-voice-transcribe-1.0`, `ENDPOINTING`, `languageBias: ["Bulgarian"]`
  - each with and without the business's 15 keywords (services, staff, booking words)
- **Reference:** ElevenLabs Scribe (batch) on the same audio, fillers dropped, numbers as digits. Scribe is wrong on two
  turns where the providers are right, which counts against the providers.
- **Turns:** 32 caller turns with words, cut by our own silence detector (a turn ends after 1.2 s of quiet).

## Results

| Variant | Word error rate | Hard words right | End of turn after the last word (p50 / p90 / max) |
| --- | --- | --- | --- |
| Deepgram | 33.1% | 19 / 35 | 576 / 3,577 / 6,967 ms |
| Deepgram + keywords (our production setting then) | 29.7% | 25 / 35 | 594 / 3,577 / 6,967 ms |
| Muse Voice Transcribe | 22.3% | 31 / 35 | 395 / 532 / 747 ms |
| **Muse Voice Transcribe + keywords** | **20.0%** | **35 / 35** | **422 / 495 / 630 ms** |

Hard words are the ones a booking depends on:

| Word | Times said | Deepgram + keywords | Muse + keywords |
| --- | --- | --- | --- |
| подстригване (haircut) | 8 | 4 | **8** |
| час (appointment) | 5 | 4 | **5** |
| запиша / запиши (book) | 8 | 6 | **8** |
| понеделник (Monday) | 6 | 3 | **6** |
| следобед (afternoon) | 2 | 2 | 2 |
| times ("в 1 часа") | 6 | 6 | 6 |

- **Accuracy:** a third fewer errors than Deepgram with keywords, and every hard word right. What's left is mostly
  gender endings (мъжка / мъжко).
- **Speed:** Muse's text for a turn is complete about 0.4 s after the last word and never later than 0.63 s. Deepgram's
  final stalled for seconds on one turn in five (p90 3.6 s, worst 6.9 s on "В 1.", "at 1").
- **Code-switching:** English speech on a Bulgarian-biased stream comes back as English words, not Cyrillic noise, so a
  call can follow the caller into English without reopening the stream (`src/language.ts`).
- **Price (published rates, Oct 2026):** Muse $0.003 per audio minute; Deepgram Nova-3 streaming with keywords
  $0.0090 (list). **51–67% cheaper.**

## Trade-offs we found

- **Handshake:** 0.8–1.6 s from Germany vs ~0.1 s for Deepgram. It overlaps the greeting, so callers don't hear it.
- **No word timestamps:** we take the stream time of the last change in the partials as the last word.
- **Keyword limit:** one keyword over 30 characters makes Meta refuse the whole session (close 1008). Any number of
  keywords is fine (500 tried). The client drops long ones.
- **Bulgarian isn't on Meta's verified language list,** but these numbers say it works.

## Since then, in production

Published receptionists run on Muse Voice Transcribe. On live calls it has also shown two edge cases we handle in our
pipeline: a short "Да" (yes) on a noisy line can come back with no words at all, so the agent asks the caller to repeat
after 1.5 s instead of waiting in silence; and on a call with another voice agent, Muse ended that agent's turn in a
0.5 s pause after a filler ("Добре, благодаря за въпроса."), which we're still tuning.
