# Hackathon submission: answers

Answers for the Meta Global AI Developer Hackathon submission form (Cerebral Valley), in form order. Submissions close
**Nov 4, 9:00 PM ET**. Fields marked * are required.

---

### Team Name *

Khairo

### Team Members

Vlad Varadinov (vladfortech). Add Kristiyan if he has a Cerebral Valley account.

### Which track are you submitting to? *

**Startups Track**

### Which problem statement did you build towards? *

**Build for Your World**

(A problem we know firsthand: one of us has a cousin who runs a dental clinic alone and can't pick up the phone
mid-treatment, and Bulgarian car services, dentists and salons still take bookings by phone.)

### Most Viral Track: X post link

Optional. If we post, a 30–60 s clip works best: a real call booking an appointment in Bulgarian, then switching to
English, with the timings on screen, tagging @AIatMeta.

### Project Description *

> Khairo is an AI receptionist for owner-run appointment businesses: car services first, then dental clinics and
> salons. The owner forwards their number to us; Khairo answers every call, books the appointment into the calendar,
> and brings customers back when their next visit is due. In Bulgaria only 17.6% of people book a practitioner online
> (EU: 39.8%), so bookings still happen on the phone, and when the mechanic is under a car the caller rings the next
> garage.
>
> For this hackathon we moved Khairo's voice core onto Meta's models and made it public. Muse Voice Transcribe is the
> receptionist's ears: it streams the caller's audio in real time and decides when their turn has ended. Muse Spark 1.2
> is its brain: it talks to the caller and books through three tools (find_slots, hold_slot, confirm_booking), resolving
> "tomorrow morning" to a date and reading every booking back before it confirms. Because Muse Voice Transcribe
> code-switches, the call follows a caller from Bulgarian into English on their first sentence.
>
> We chose both models by benchmark, not by default. On our real Bulgarian calls Muse Voice Transcribe made a third fewer
> errors than Deepgram Nova-3 (20.0% vs 29.7% word error rate), got every booking-critical word right, and ended turns
> in ~0.4 s instead of up to 6.9 s, at a third of the price. Muse Spark picked the right tool with the right inputs in
> 36 of 36 tries, with a 0.8 s median first token. Both now run our published receptionists on real phone lines.
>
> To keep booking turns from going silent while a tool runs, Muse Spark starts each tool turn with a short echo of what
> the caller said ("A brake inspection tomorrow afternoon…"), spoken while the tool and its second round run. In
> production, the caller's last word to the agent's voice is 1.86 s at the median, at about 5 cents a minute.
>
> Try it live in English: call +1 (415) 873-5520, or talk to it in the browser at khairo.ai/demo. It answers for Golden
> Gate Auto Care, a demo car service in San Francisco, on our production platform.
>
> The public repo is the Meta part, runnable with only a Meta API key: a WAV-to-booking call pipeline at real-time pace,
> a text mode, and the benchmark that reproduces our numbers.

### Public GitHub Repository *

https://github.com/khairoai/receptionist-service

### 3-Minute Demo Video *

_YouTube link (unlisted is fine)._ Script below.

### Describe your use of Meta products to build the submitted project *

> We use two Meta models through the Meta Model API, both in production on our phone lines.
>
> 1. Muse Voice Transcribe (muse-voice-transcribe-1.0), over the realtime WebSocket in ENDPOINTING mode with cumulative
> partials, a Bulgarian language bias and the business's keywords (service names, booking words). We stream phone audio
> in 20 ms frames; its speechComplete event ends the caller's turn and hands the text to the model. We use its
> code-switching on purpose: English speech on a Bulgarian-biased stream comes back as English words, so we switch the
> call's language from the script of the caller's words, instantly and without reopening the stream.
>
> 2. Muse Spark 1.2, through the OpenAI-compatible Chat Completions endpoint, streamed, with tool calling and
> reasoning_effort "minimal". It runs the conversation and the booking flow: find_slots (service id from the catalog,
> an ISO date it resolves from the caller's words, part of day), hold_slot (only slot ids find_slots returned) and
> confirm_booking (only after reading the booking back and hearing a clear yes). We rely on its automatic prompt cache:
> from the second request of a call, most of the prompt is a cache read.
>
> We integrated both into our existing provider-agnostic voice stack and A/B tested them against Deepgram Nova-3, Claude
> Haiku and a self-hosted Bulgarian model, on real call recordings replayed at real-time pace. Muse won for speech-to-text
> and matched our previous model on the conversation, so both became the defaults for published receptionists. The
> repo has both clients, the receptionist, a WAV-to-booking demo and a reproducible benchmark (pnpm bench:spark). We
> don't use Contributor mode, because callers say their names and phone numbers.

### Why are Meta's models important to your solution? *

> On a phone call, speech-to-text quality and turn-taking decide whether a booking happens. Before Muse Voice
> Transcribe, the words our bookings depend on were the ones we missed: "час" (appointment) heard as "чат" (chat),
> "подстригване" (haircut) mangled, and some turns waited up to 6.9 s for a final transcript on a silent line, so
> callers repeated themselves or hung up. Muse got all 35 booking-critical words right on the same calls and ends a turn
> ~0.4 s after the caller stops, with a 0.63 s worst case. That is the difference between an agent that feels like a
> person and one that feels broken. It's also about a third of the price, which matters when we sell a monthly
> subscription to a two-person garage.
>
> Bulgarian isn't on Meta's verified language list, yet Muse beat the specialist provider on it. Code-switching gives us
> bilingual calls (tourists, expats, foreign-plated cars) without a second stream or a language-detection model.
>
> Muse Spark gives us reliable tool calls (36/36, relative dates resolved correctly) at a first-token latency that fits a
> phone conversation, with one key for both ears and brain. Meta's models let a small team ship a receptionist that
> books, in a language big vendors under-serve, at a price small businesses can pay.

### Feedback on partner technologies (Fireworks, Modal, Baseten)

We didn't use them: everything ran on the Meta Model API directly. (Leave blank, or paste this.)

### How likely are you to build with Meta Model API? *

**Very likely.** Both models are already our production defaults. ⚠️ The form currently shows "Very unlikely"
selected; change it.

### How would you describe your overall opinion of Meta Model API? *

**Very favorable.** Muse Voice Transcribe beat our incumbent on every measure. Alternative: "Somewhat favorable", if you
want the friction to count (no usage API or usage page to reconcile billing, `tool_choice` only `"auto"`, reasoning
can't be turned off).

### How likely are you to recommend the Meta Model API to another developer? (0–5)

**4**

### How likely are you to recommend Muse Code? (0–5)

Leave blank unless we used Muse Code for this.

### What was the biggest obstacle your team hit while building this project?

**Slow responses.** Muse Spark's time to first token (0.4–1.5 s; it always reasons, and `minimal` is the floor) is
the largest part of our voice-to-voice latency. A self-hosted model on our own GPUs answered in ~0.2 s. The same
measurements put Muse Spark 1.3 at 1.5–2× slower than 1.2.

### Compared with other AI models your team has used for the same kind of work, how did Meta's models perform?

**Somewhat better.** Speech-to-text: much better than Deepgram Nova-3 on Bulgarian (20.0% vs 29.7% WER, 0.4 s vs up
to 6.9 s to end a turn). Conversation: about the same as Claude Haiku on tool accuracy and first-token latency.

### When your team chooses an AI model or coding tool, what matters most?

**Speed.** On a phone call every reasoning token is silence the caller hears.

### What makes it hardest for your team to switch to a different AI model or coding tool?

**Testing a new model takes too long.** Switching is one environment variable in our stack; knowing it's safe needs
replays of real calls, a live call, and a tool-accuracy run.

### If your team took this project to production, what would most likely stop you from using Meta's models?

**How our data and our users' data would be stored or used.** Callers give names and phone numbers, and our customers
are EU businesses under GDPR, so we need clear retention terms and EU processing. Contributor mode is a non-starter
for us.

### Permission checkbox

Tick it (grants Meta and Cerebral Valley permission to use and promote the submission).

---

## Demo video script (3:00)

Record the phone call on a real phone (screen recording of the dialler plus the agent's audio), and the terminal and
docs as screen capture. Captions in English for the Bulgarian lines.

| Time | On screen | Voice-over |
| --- | --- | --- |
| 0:00–0:15 | A garage owner under a car, phone ringing, missed call | "In Bulgaria, booking a car service, a dentist or a haircut still means a phone call. And when the mechanic is under a car, that call goes to the next garage." |
| 0:15–0:30 | khairo.ai | "We're Khairo. Our AI receptionist answers every call on the business's own number and books the appointment into the calendar. For this hackathon we rebuilt its voice core on Meta's Muse models." |
| 0:30–1:20 | **Live call** to the demo line, +1 (415) 873-5520 (or khairo.ai/demo in the browser): book an oil change "tomorrow morning", pick a time, give a name, confirm. Show the booking appear in Golden Gate Auto Care's calendar in the Khairo dashboard. | Minimal voice-over: let the call play, captioned. "No menu, no 'press 1'. It found the slot, held it, read it back, and booked only after a clear yes." |
| 1:20–1:45 | Terminal: `pnpm call samples/en-tyre-change/*.wav` (an English caller on a Bulgarian line) | "Our home market is Bulgaria. Muse Voice Transcribe code-switches: English on a Bulgarian line comes back as English words, so Khairo follows the caller from their first sentence." |
| 1:45–2:20 | Benchmark tables from `docs/benchmarks/` | "We picked Muse by benchmark. On our real calls: 20% word error rate against 30% for Deepgram, every booking word right, the caller's turn ends in 0.4 seconds instead of up to 7, at a third of the price. Muse Spark: the right tool with the right inputs 36 times out of 36, first word in under a second." |
| 2:20–2:45 | Terminal: `pnpm call samples/bg-oil-change/*.wav` with the timing table; the repo | "The Meta part is public: a call from WAV to booking, at real-time pace, with one Meta API key." |
| 2:45–3:00 | Back to the garage; logo | "Both models answer our customers' phones today. Next: Khairo calls customers back when their next service is due. Khairo, on Meta Muse." |
