import type { ReactNode } from "react";

// The key phrase of a heading, in the brand's mint running into teal (the colours of the hero's two glows), at the
// heading's own weight. A gradient on the letters, not a box behind them, so it reads as part of the line on dark green.
export function Highlight({ children, wrap = false }: { children: ReactNode; wrap?: boolean }) {
  return (
    <mark
      className={`${wrap ? "" : "whitespace-nowrap"} bg-gradient-to-r from-emerald-300 via-emerald-200 to-teal-200 bg-clip-text pb-[0.08em] text-transparent box-decoration-clone`}
    >
      {children}
    </mark>
  );
}
