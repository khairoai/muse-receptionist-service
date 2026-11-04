import { Logo } from "@/components/brand";
import { GITHUB_HREF, SITE_HREF, WAITLIST_HREF } from "@/components/content/demo";

// khairo.ai's footer, with its links pointing at khairo.ai and this repo.

const COLUMNS = [
  {
    label: "Product",
    links: [
      { title: "Features", href: `${SITE_HREF}/features` },
      { title: "Live demo", href: `${SITE_HREF}/demo` },
      { title: "Join the waitlist", href: WAITLIST_HREF },
    ],
  },
  {
    label: "Industries",
    links: [
      { title: "Car service & repair", href: `${SITE_HREF}/industries/car-service` },
      { title: "Dental clinics", href: `${SITE_HREF}/industries/dental-clinics` },
      { title: "Beauty salons", href: `${SITE_HREF}/industries/beauty-salons` },
    ],
  },
  {
    label: "This demo",
    links: [
      { title: "Source on GitHub", href: GITHUB_HREF },
      { title: "Benchmarks", href: `${GITHUB_HREF}#benchmarks` },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border pb-10 pt-16">
      <div className="grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-[1.6fr_repeat(3,1fr)]">
        <div className="col-span-2 max-w-xs lg:col-span-1">
          <a href={SITE_HREF} className="text-white" aria-label="Khairo home">
            <Logo />
          </a>
          <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
            The AI receptionist that answers every call, books the visit and brings customers back. This one runs on Meta&apos;s Muse
            Voice Transcribe and Muse Spark.
          </p>
        </div>
        <nav aria-label="Footer" className="contents">
          {COLUMNS.map((col) => (
            <div key={col.label}>
              <p className="text-[13px] font-bold uppercase tracking-wider text-white">{col.label}</p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <a href={l.href} className="text-[14px] text-muted-foreground transition-colors hover:text-white">
                      {l.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6 text-[13px] text-muted-foreground">
        <span>© 2026 Khairo. Open source under the Apache License 2.0.</span>
      </div>
    </footer>
  );
}
