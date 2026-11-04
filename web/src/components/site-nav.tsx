"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/brand";
import { GITHUB_HREF, SITE_HREF, WAITLIST_HREF } from "@/components/content/demo";

// khairo.ai's top bar, as on its /demo page: the logo, the site's main links (to khairo.ai) and the waitlist button.
// The menus' panels stay on khairo.ai; here the links go straight to its pages. The bar sticks to the top as the page
// scrolls, in one of three tones: clear at the very top (the hero's green shows through), dark frosted glass while
// it's over the hero, and white once the hero has scrolled past. The hero marks itself with data-site-hero.

type Tone = "clear" | "glass" | "light";

function useTone(bar: RefObject<HTMLElement | null>): Tone {
  const [tone, setTone] = useState<Tone>("clear");
  useEffect(() => {
    const update = () => {
      if (window.scrollY < 8) return setTone("clear");
      const hero = document.querySelector("[data-site-hero]");
      const barBottom = bar.current?.getBoundingClientRect().bottom ?? 0;
      setTone(!hero || hero.getBoundingClientRect().bottom <= barBottom ? "light" : "glass");
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [bar]);
  return tone;
}

const BAR: Record<Tone, string> = {
  clear: "bg-transparent",
  glass: "bg-[oklch(0.17_0.035_165/0.78)] shadow-[0_1px_0_oklch(1_0_0/0.08)] backdrop-blur-md",
  light: "bg-white shadow-[0_1px_0_oklch(0_0_0/0.06),0_10px_30px_-18px_oklch(0.2_0.04_165/0.45)]",
};

const topLink = (light: boolean) =>
  `flex h-10 items-center gap-1 rounded-lg px-3.5 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 ${
    light
      ? "text-[oklch(0.3_0.02_165)] hover:bg-[oklch(0.2_0.03_165/0.05)] hover:text-[oklch(0.18_0.03_165)] focus-visible:ring-[oklch(0.6_0.12_160)]"
      : "text-white/85 hover:bg-white/[0.06] hover:text-white focus-visible:ring-white/40"
  }`;

const LINKS = [
  { title: "Features", href: `${SITE_HREF}/features` },
  { title: "Industries", href: `${SITE_HREF}/industries` },
  { title: "Solutions", href: `${SITE_HREF}/solutions` },
  { title: "GitHub", href: GITHUB_HREF },
];

export function SiteNav() {
  const bar = useRef<HTMLElement>(null);
  const tone = useTone(bar);
  const light = tone === "light";
  return (
    <header ref={bar} className={`sticky top-0 z-40 transition-[background-color,box-shadow] duration-300 ${BAR[tone]}`}>
      <div className="site-container site-nav">
        <a
          href={SITE_HREF}
          className={`shrink-0 transition-colors duration-300 ${light ? "text-[oklch(0.2_0.03_165)]" : "text-white"}`}
          aria-label="Khairo home"
        >
          <Logo />
        </a>
        <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Main">
          {LINKS.map((link) => (
            <a key={link.title} href={link.href} className={topLink(light)}>
              {link.title}
            </a>
          ))}
        </nav>
        <a
          href={WAITLIST_HREF}
          className="inline-flex h-11 items-center rounded-xl bg-primary px-5 text-[15px] font-bold text-primary-foreground transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 max-sm:h-10 max-sm:px-4"
        >
          Join the waitlist
        </a>
      </div>
    </header>
  );
}
