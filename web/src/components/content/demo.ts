// The demo page's business: Golden Gate Auto Care, the demo car service the receptionist answers for. These facts
// match src/calendar.ts (BUSINESS); the page states them, the receptionist answers from them.

export const SITE_HREF = "https://khairo.ai";
export const WAITLIST_HREF = "https://khairo.ai/#waitlist";
export const GITHUB_HREF = "https://github.com/khairoai/muse-receptionist-service";

// khairo.ai/demo's own line, on our production stack, for visitors who'd rather use their phone
export const DEMO_PHONE = "+14158735520";
export const DEMO_PHONE_LABEL = "+1 (415) 873-5520";

/** A question and its answer; `link` follows the answer as a call to action. */
export type Faq = { q: string; a: string; link?: { label: string; href: string } };

export const DEMO_BUSINESS = {
  name: "Golden Gate Auto Care",
  place: "San Francisco, California",
  city: "San Francisco",
  hours: [
    { days: "Monday–Friday", time: "8 am–6 pm" },
    { days: "Saturday", time: "9 am–2 pm" },
    { days: "Sunday", time: "Closed" },
  ],
  timeZone: "Pacific Time",
  services: ["Oil change", "Tire rotation", "Brake inspection", "Check-engine-light diagnostic", "California smog check"],
};

// What the receptionist does on every call, next to the headline: what a business owner gets.
export const DEMO_PROMISES = [
  "Picks up on the first ring, day or night",
  "Quotes your real prices and hours",
  "Books and cancels appointments",
  "Reads every booking back before confirming",
];

// The calendar section: how bookings reach the owner's calendar, as on khairo.ai/demo.
export const DEMO_CALENDAR = [
  {
    title: "Google Calendar or ours",
    body: "Connect Google Calendar and it stays your record, or use the calendar that comes with Khairo.",
  },
  { title: "Your own bookings count", body: "Appointments you add yourself block the time, so Khairo never offers a slot that's taken." },
  {
    title: "Checked again before it's final",
    body: "The slot is held while the caller decides and checked once more right before the booking is confirmed.",
  },
  {
    title: "No double bookings",
    body: "Each visit needs a free mechanic and a free lift, or a dentist and a chair, not just a free time.",
  },
];

// The setup, in the order Khairo's dashboard asks for it, then the number.
export const DEMO_SETUP = [
  {
    title: "Tell Khairo about your business",
    body: "Your services with prices and how long each takes, your staff and your opening hours. About ten minutes.",
  },
  {
    title: "Connect your calendar",
    body: "Google Calendar, or the calendar that comes with Khairo. Bookings land there the moment they're made.",
  },
  {
    title: "Set your rules",
    body: "How soon and how far ahead people can book, what they may move or cancel, and when a call comes through to you.",
  },
  {
    title: "Forward your number",
    body: "Keep the number your customers know. Send every call to Khairo, or only the ones you can't pick up.",
  },
];

export const DEMO_FAQS: Faq[] = [
  {
    q: "Is this a real AI?",
    a: "Yes. Nothing is scripted or pre-recorded. Meta's Muse Voice Transcribe hears you and decides when you've finished, Muse Spark answers from the garage's data and books through the calendar tools, and ElevenLabs gives it a voice.",
  },
  {
    q: "Where does this copy run?",
    a: "On your machine, from this repo: pnpm demo serves this page and the call. Your audio goes to Meta's Model API and the replies to ElevenLabs; nothing is recorded. The calendar lives in memory, so every call starts from a fresh day.",
  },
  {
    q: "Why a San Francisco garage?",
    a: "It's a demo business, so anyone can try a real booking without bothering a real one. Our first customers are car services and clinics in Europe.",
  },
  {
    q: "Can I use it for my business?",
    a: "Soon. Khairo answers your own number: forward it to us and the receptionist answers from your prices, hours and calendar. We're onboarding the first businesses from the waitlist.",
    link: { label: "Join the waitlist", href: WAITLIST_HREF },
  },
];
