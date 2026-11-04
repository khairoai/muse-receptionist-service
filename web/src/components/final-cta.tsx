import { ArrowRight } from "lucide-react";
import { GITHUB_HREF, WAITLIST_HREF } from "@/components/content/demo";

// The last word before the footer, as on khairo.ai: a full-width band in a brighter emerald than the footer's dark
// green, with the waitlist and this repo.

const BAND =
  "radial-gradient(60% 120% at 10% 0%, oklch(0.62 0.14 155 / 0.9), transparent 70%), radial-gradient(50% 110% at 95% 100%, oklch(0.5 0.1 185 / 0.8), transparent 70%), oklch(0.52 0.12 162)";

export function FinalCta() {
  return (
    <section
      className="relative left-1/2 w-screen -translate-x-1/2 overflow-hidden px-6 py-20 text-center md:px-16 md:py-28"
      style={{ background: BAND }}
      aria-labelledby="final-cta-heading"
    >
      <h2
        id="final-cta-heading"
        className="mx-auto max-w-4xl text-[36px] font-extrabold leading-[1.05] tracking-[-0.03em] text-white sm:text-[56px] lg:text-[68px]"
      >
        Never miss a booking <span className="whitespace-nowrap text-[oklch(0.94_0.07_160)]">again.</span>
      </h2>
      <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/85 md:text-xl">
        Forward your number, and Khairo answers, books and brings customers back. Be one of the first clinics, salons and garages to go
        live.
      </p>
      <div className="mt-10 flex flex-wrap justify-center gap-3">
        <a
          href={WAITLIST_HREF}
          className="inline-flex h-13 items-center gap-2 rounded-xl bg-white px-7 text-[16px] font-bold text-[oklch(0.3_0.07_162)] shadow-[0_10px_24px_-12px_rgba(0,40,20,0.6)] transition hover:bg-[oklch(0.97_0.02_160)]"
        >
          Join the waitlist
          <ArrowRight className="size-4" strokeWidth={2.5} />
        </a>
        <a
          href={GITHUB_HREF}
          className="inline-flex h-13 items-center rounded-xl border border-white/50 px-7 text-[16px] font-semibold text-white transition hover:bg-white/10"
        >
          See the code
        </a>
      </div>
      <p className="mt-5 text-sm text-white/75">Early access. No contracts. Cancel any time.</p>
    </section>
  );
}
