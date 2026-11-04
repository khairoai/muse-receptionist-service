"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { DEMO_BUSINESS } from "@/components/content/demo";
import { DemoBackstage } from "@/components/demo-backstage";
import { DemoCall, type DemoCallState } from "@/components/demo-call";

// The demo page's hero, as on khairo.ai/demo: the headline and the call card. Before a call, the copy under the headline says what the receptionist
// does; once a call starts it gives way to what the garage sees behind it (demo-backstage.tsx) and stays after the
// call, so the visitor can see what they booked. On a phone the panel comes after the call card. The swap is a
// cross-fade in one grid cell (the copy blurs up and out, the panel rises in) inside a box whose height follows its
// content, so the page below glides down instead of jumping. Reduced motion keeps the fades and drops the movement.

const EASE = [0.22, 1, 0.36, 1] as const;

// A box that animates to its content's height. Clips only while it moves, so the panel's shadow shows at rest.
function SmoothHeight({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <motion.div
      initial={false}
      animate={{ height }}
      transition={{ duration: 0.8, ease: EASE }}
      onAnimationStart={() => setMoving(true)}
      onAnimationComplete={() => setMoving(false)}
      style={{ overflow: moving ? "hidden" : "visible" }}
    >
      <div ref={inner}>{children}</div>
    </motion.div>
  );
}

// The call card: the business it answers for, then the call itself.
function CallCard({ onCall }: { onCall: (call: DemoCallState) => void }) {
  return (
    <section
      aria-label="Call the receptionist"
      className="relative overflow-hidden rounded-[30px] border border-white/12 bg-[oklch(0.2_0.035_165)] shadow-[0_50px_100px_-50px_oklch(0.1_0.04_165)]"
      style={{ backgroundImage: "radial-gradient(90% 55% at 50% 0%, oklch(0.42 0.1 160 / 0.45), transparent 75%)" }}
    >
      <header className="flex items-start justify-between gap-4 px-6 pt-5 sm:px-7 sm:pt-6">
        <div className="min-w-0">
          <p className="text-[17px] font-extrabold leading-tight text-white sm:text-[18px]">{DEMO_BUSINESS.name}</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {DEMO_BUSINESS.city} · {DEMO_BUSINESS.timeZone}
          </p>
        </div>
        <p className="mt-0.5 flex shrink-0 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-primary">
          <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
          Live<span className="max-sm:hidden"> · English</span>
        </p>
      </header>
      <div className="px-6 pb-6 pt-1 sm:px-7 sm:pb-7 sm:pt-2">
        <DemoCall onCall={onCall} />
      </div>
    </section>
  );
}

export function DemoHero({ heading, intro }: { heading: ReactNode; intro: ReactNode }) {
  const [call, setCall] = useState<DemoCallState>({ phase: "idle", since: null, live: null });
  const backstage = call.since !== null;

  return (
    <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)] lg:gap-x-16 lg:gap-y-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,500px)]">
      <div className="lg:col-start-1 lg:row-start-1 lg:pt-6">{heading}</div>
      <div className={`lg:col-start-1 lg:row-start-2 ${backstage ? "order-last lg:order-none" : ""}`}>
        <MotionConfig reducedMotion="user">
          <SmoothHeight>
            {/* Both in one cell while they cross: the cell is as tall as the taller one */}
            <div className="grid">
              <AnimatePresence initial={false}>
                {backstage ? (
                  <motion.div
                    key="backstage"
                    className="[grid-area:1/1]"
                    initial={{ opacity: 0, y: 28, scale: 0.975, filter: "blur(10px)" }}
                    animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                    transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
                  >
                    <DemoBackstage call={call} />
                  </motion.div>
                ) : (
                  <motion.div
                    key="intro"
                    className="[grid-area:1/1]"
                    exit={{ opacity: 0, y: -16, filter: "blur(8px)" }}
                    transition={{ duration: 0.4, ease: EASE }}
                  >
                    {intro}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </SmoothHeight>
        </MotionConfig>
      </div>
      <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
        <CallCard onCall={setCall} />
      </div>
    </div>
  );
}
