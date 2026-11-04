import { ArrowRight, Plus } from "lucide-react";
import type { Faq } from "@/components/content/demo";

// The page's questions, split: the heading on the left (it stays in view on desktop while the answers scroll), the
// questions on the right as native disclosures, so they open without JavaScript.
export function EntryFaq({ index, title, items }: { index?: string; title: string; items: Faq[] }) {
  return (
    <section
      className="grid gap-10 py-16 md:py-20 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16"
      aria-labelledby="faq-heading"
    >
      <div className="lg:sticky lg:top-28 lg:self-start">
        <p className="flex items-center gap-3 text-[13px] font-bold uppercase tracking-[0.16em] text-emerald-700">
          {index && <span className="font-mono tabular-nums opacity-70">{index}</span>}
          Questions
        </p>
        <h2 id="faq-heading" className="mt-4 text-[34px] font-extrabold leading-[1.04] tracking-[-0.03em] sm:text-[48px]">
          {title}
        </h2>
      </div>
      <ul className="border-t-[3px] border-[oklch(0.3_0.06_160)]">
        {items.map((item) => (
          <li key={item.q} className="border-b border-[oklch(0.86_0.02_150)]">
            <details className="group">
              <summary className="flex list-none items-start justify-between gap-6 rounded-lg py-6 text-[18px] font-bold leading-snug outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 md:text-[19px] [&::-webkit-details-marker]:hidden">
                {item.q}
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-[oklch(0.84_0.03_158)] text-emerald-700 transition-transform duration-200 group-open:rotate-45 group-open:border-emerald-600 group-open:bg-emerald-600 group-open:text-white motion-reduce:transition-none">
                  <Plus className="size-4" strokeWidth={2.5} aria-hidden="true" />
                </span>
              </summary>
              <p className="max-w-2xl pb-7 pr-12 text-[16px] leading-relaxed opacity-75">{item.a}</p>
              {item.link && (
                <a
                  href={item.link.href}
                  className="-mt-3 mb-7 inline-flex items-center gap-1.5 text-[15px] font-bold text-emerald-700 hover:text-emerald-800"
                >
                  {item.link.label}
                  <ArrowRight className="size-4" strokeWidth={2.5} aria-hidden="true" />
                </a>
              )}
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
