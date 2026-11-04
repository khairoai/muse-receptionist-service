import type { ReactNode } from "react";

// khairo.ai's inner-page building blocks: the off-white arrives as a sheet with rounded top corners that slides over
// the dark hero, and each section inside it opens with a small numbered label and a left-aligned heading.

export const PAPER = "oklch(0.975 0.01 115)";
export const INK = "text-[oklch(0.24_0.03_160)]";

export function PaperSheet({ children }: { children: ReactNode }) {
  return (
    <div
      className={`relative left-1/2 w-screen -translate-x-1/2 rounded-t-[40px] pb-8 pt-4 md:rounded-t-[56px] ${INK}`}
      style={{ background: PAPER }}
    >
      <div className="mx-auto w-[min(1280px,calc(100%-32px))] md:w-[min(1280px,calc(100%-96px))]">{children}</div>
    </div>
  );
}

export function SectionTitle({
  id,
  index,
  label,
  title,
  lead,
}: {
  id: string;
  index?: string;
  label: string;
  title: ReactNode;
  lead?: ReactNode;
}) {
  return (
    <div className="max-w-3xl">
      <p className="flex items-center gap-3 text-[13px] font-bold uppercase tracking-[0.16em] text-emerald-700">
        {index && <span className="font-mono tabular-nums opacity-70">{index}</span>}
        {label}
      </p>
      <h2 id={id} className="mt-4 text-[32px] font-extrabold leading-[1.06] tracking-[-0.025em] sm:text-[44px]">
        {title}
      </h2>
      {lead && <p className="mt-5 text-lg leading-relaxed opacity-70">{lead}</p>}
    </div>
  );
}
