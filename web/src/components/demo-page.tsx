import { CalendarCheck, CalendarSync, Check, Clock, PhoneForwarded, SlidersHorizontal, Store, Wrench } from "lucide-react";
import { DEMO_BUSINESS, DEMO_CALENDAR, DEMO_FAQS, DEMO_PROMISES, DEMO_SETUP } from "@/components/content/demo";
import { DemoHero } from "@/components/demo-hero";
import { EntryFaq } from "@/components/entry-faq";
import { FinalCta } from "@/components/final-cta";
import { Highlight } from "@/components/section-header";
import { PaperSheet, SectionTitle } from "@/components/site-sections";

// khairo.ai/demo, on this repo's receptionist: hear it for yourself, in the browser. The hero (demo-hero.tsx) is the
// call: the headline and what the receptionist does on the left, the call card (demo-call.tsx) as the focal point on
// the right; once a call starts, the left side shows what the garage sees behind it (demo-backstage.tsx). The sheet
// below has the demo business's facts, how bookings reach the owner's calendar, the four setup steps, questions, then
// the waitlist band.

const CARD = "rounded-3xl border border-[oklch(0.89_0.025_158)] bg-white";

// One morning of the demo garage's calendar: the booking the receptionist just made, between one the owner added.
function CalendarPreview() {
  const rows = [
    { time: "8:00", item: { title: "Oil change", who: "Alex Morgan", by: "Booked by Khairo", khairo: true } },
    { time: "9:00", item: null },
    { time: "10:00", item: { title: "Brake inspection", who: "Sam Lee", by: "Added by you", khairo: false } },
    { time: "11:00", item: null },
  ];
  return (
    <div className={`${CARD} p-5 shadow-[0_30px_60px_-40px_oklch(0.3_0.06_160/0.5)] sm:p-6`} aria-hidden="true">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[15px] font-extrabold">Thursday, 5 November</p>
        <div className="flex gap-1.5 text-[11.5px] font-bold">
          <span className="rounded-full border border-emerald-600/25 bg-emerald-50 px-2.5 py-1 text-emerald-800">Google Calendar</span>
          <span className="rounded-full border border-[oklch(0.89_0.025_158)] px-2.5 py-1 opacity-70">Khairo calendar</span>
        </div>
      </div>
      <ol className="mt-5 space-y-2">
        {rows.map((row) => (
          <li key={row.time} className="grid grid-cols-[48px_1fr] items-center gap-3">
            <span className="font-mono text-[12px] tabular-nums opacity-55">{row.time}</span>
            {row.item ? (
              <span
                className={`flex items-center justify-between gap-3 rounded-2xl px-4 py-3 ${row.item.khairo ? "bg-emerald-600 text-white" : "bg-[oklch(0.95_0.012_150)]"}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-bold">{row.item.title}</span>
                  <span className={`block truncate text-[12.5px] ${row.item.khairo ? "text-white/80" : "opacity-60"}`}>{row.item.who}</span>
                </span>
                <span
                  className={`flex shrink-0 items-center gap-1.5 text-[11.5px] font-bold ${row.item.khairo ? "text-white" : "opacity-55"}`}
                >
                  {row.item.khairo && <CalendarCheck className="size-3.5" strokeWidth={2.5} />}
                  {row.item.by}
                </span>
              </span>
            ) : (
              <span className="h-11 rounded-2xl border border-dashed border-[oklch(0.88_0.02_150)]" />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

// How bookings reach the owner's calendar, next to a morning of the demo garage's.
function CalendarSection() {
  return (
    <section className="grid gap-10 py-16 md:py-20 lg:grid-cols-2 lg:items-center lg:gap-16" aria-labelledby="calendar-heading">
      <div>
        <SectionTitle
          id="calendar-heading"
          index="02"
          label="Calendar"
          title="Books straight into your calendar."
          lead="Every booking from the call is in your calendar before the caller hangs up, with their name and the service."
        />
        <ul className="mt-8 grid gap-5 sm:grid-cols-2">
          {DEMO_CALENDAR.map((point) => (
            <li key={point.title}>
              <p className="flex items-center gap-2 text-[16px] font-extrabold">
                <Check className="size-4 shrink-0 text-emerald-700" strokeWidth={3} aria-hidden="true" />
                {point.title}
              </p>
              <p className="mt-1.5 text-[15px] leading-relaxed opacity-75">{point.body}</p>
            </li>
          ))}
        </ul>
      </div>
      <CalendarPreview />
    </section>
  );
}

const SETUP_ICONS = [Store, CalendarSync, SlidersHorizontal, PhoneForwarded];

// The four setup steps, as the dashboard asks for them.
function SetupSection() {
  return (
    <section className="py-16 md:py-20" aria-labelledby="setup-heading">
      <SectionTitle
        id="setup-heading"
        index="03"
        label="How it works"
        title="Your own receptionist, live the same day."
        lead="No sales call and no new phone number. Set it up yourself in the dashboard, hear it answer, then switch it on."
      />
      <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {DEMO_SETUP.map((step, i) => {
          const Icon = SETUP_ICONS[i] ?? Store;
          return (
            <li key={step.title} className={`${CARD} p-6`}>
              <span className="flex items-center justify-between">
                <span className="grid size-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                  <Icon className="size-5" strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="font-mono text-[13px] font-bold tabular-nums text-emerald-700/70">Step {i + 1}</span>
              </span>
              <h3 className="mt-5 text-[18px] font-extrabold leading-snug">{step.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed opacity-75">{step.body}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function DemoPage({ eyebrow }: { eyebrow: string }) {
  return (
    <>
      {/* Marked as the site hero so the top bar stays dark over it (site-nav.tsx) */}
      <section className="relative pb-16 pt-4 md:pt-10 lg:pb-20" aria-labelledby="page-heading" data-site-hero>
        <DemoHero
          heading={
            <>
              <p className="mb-4 text-[13px] font-semibold uppercase tracking-[0.14em] text-emerald-300/80 sm:text-sm">{eyebrow}</p>
              <h1
                id="page-heading"
                className="text-[36px] font-extrabold leading-[1.04] tracking-[-0.03em] text-white min-[420px]:text-[42px] sm:text-[54px] xl:text-[62px]"
              >
                Talk to our AI receptionist, <Highlight>live.</Highlight>
              </h1>
            </>
          }
          intro={
            <>
              <p className="max-w-xl text-[16px] leading-relaxed text-muted-foreground sm:text-lg md:text-xl md:leading-relaxed">
                {DEMO_BUSINESS.name} is a demo car service in {DEMO_BUSINESS.city}. Ask about prices and hours, then book or cancel an
                appointment, and watch it land in the garage’s calendar as you talk.
              </p>
              <ul className="mt-7 grid max-w-xl gap-3 sm:mt-9 sm:grid-cols-2">
                {DEMO_PROMISES.map((promise) => (
                  <li key={promise} className="flex items-start gap-3 text-[15.5px] leading-snug text-white/90">
                    <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                      <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
                    </span>
                    {promise}
                  </li>
                ))}
              </ul>
            </>
          }
        />
      </section>

      <PaperSheet>
        <section className="grid gap-10 py-16 md:grid-cols-2 md:py-20" aria-labelledby="business-heading">
          <SectionTitle
            id="business-heading"
            index="01"
            label="The demo business"
            title={DEMO_BUSINESS.name}
            lead={`A car service in ${DEMO_BUSINESS.place} that doesn't exist: the receptionist and its calendar are real, the garage is a demo. No real garage will call you.`}
          />
          <dl className="grid gap-5 sm:grid-cols-2">
            <div className="rounded-3xl border border-[oklch(0.89_0.025_158)] bg-white p-6">
              <dt className="flex items-center gap-2.5 text-[13px] font-bold uppercase tracking-[0.14em] text-emerald-700">
                <Clock className="size-4" strokeWidth={2.25} aria-hidden="true" />
                Hours ({DEMO_BUSINESS.timeZone})
              </dt>
              <dd className="mt-4 space-y-2 text-[15.5px]">
                {DEMO_BUSINESS.hours.map((h) => (
                  <p key={h.days} className="flex justify-between gap-4">
                    <span className="opacity-75">{h.days}</span>
                    <span className="font-semibold">{h.time}</span>
                  </p>
                ))}
              </dd>
            </div>
            <div className="rounded-3xl border border-[oklch(0.89_0.025_158)] bg-white p-6">
              <dt className="flex items-center gap-2.5 text-[13px] font-bold uppercase tracking-[0.14em] text-emerald-700">
                <Wrench className="size-4" strokeWidth={2.25} aria-hidden="true" />
                Services
              </dt>
              <dd className="mt-4">
                <ul className="space-y-2 text-[15.5px]">
                  {DEMO_BUSINESS.services.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
        </section>

        <div className="border-t border-[oklch(0.88_0.02_150)]">
          <CalendarSection />
        </div>
        <div className="border-t border-[oklch(0.88_0.02_150)]">
          <SetupSection />
        </div>

        <div className="border-t border-[oklch(0.88_0.02_150)]">
          <EntryFaq index="04" title="About this demo" items={DEMO_FAQS} />
        </div>
      </PaperSheet>

      <FinalCta />
    </>
  );
}
