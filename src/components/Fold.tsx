"use client";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";

/**
 * Something the person can look at but doesn't need first: a title, one line on what's inside, and
 * Show / Hide. Closed by default, so the answer stays the first thing on the page.
 */
export function Fold({ title, sub, children, open: initial = false, testId }: { title: string; sub?: string; children: React.ReactNode; open?: boolean; testId?: string }) {
  const [open, setOpen] = useState(initial);
  // Something inside now needs the person (a paused step): open it for them.
  useEffect(() => {
    if (initial) setOpen(true);
  }, [initial]);
  return (
    <section className="rounded-2xl border-[1.5px] border-[#e2dfd6] bg-panel" data-testid={testId}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2.5 text-left sm:px-5" data-testid={testId ? `${testId}-toggle` : undefined}>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] font-semibold text-ink">{title}</span>
          {sub && <span className="text-[13px] text-ink-3">{sub}</span>}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-agent-ink">
          {open ? "Hide" : "Show"}
          <Icon name="chevron" size={13} className={`transition-transform ${open ? "-rotate-90" : "rotate-90"}`} />
        </span>
      </button>
      {open && <div className="space-y-4 px-4 pb-4 sm:px-5 sm:pb-5">{children}</div>}
    </section>
  );
}
