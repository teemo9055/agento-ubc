"use client";
import { useEffect, useState } from "react";
import type { ComposeTrace } from "@/lib/types";

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Counts a number up from 0 once it's its turn; shows the end value at once when motion is reduced. */
function useCount(to: number, startMs: number, ms = 420) {
  const [v, setV] = useState(() => (reduced() ? to : 0));
  useEffect(() => {
    if (reduced()) {
      setV(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now() + startMs;
    const tick = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - t0) / ms));
      setV(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, startMs, ms]);
  return v;
}

/**
 * How the plans were found, as three numbers: services searched → relevant → plans built, then each
 * question the problem needs with whether a service covers it.
 */
export function ComposeFunnel({ trace, plans }: { trace: ComposeTrace; plans: number }) {
  const searched = useCount(trace.searched, 0);
  const relevant = useCount(trace.relevant, 400);
  const built = useCount(plans, 800, 300);
  const [ticked, setTicked] = useState(() => (reduced() ? trace.facts.length : 0));
  useEffect(() => {
    if (reduced()) return setTicked(trace.facts.length);
    const timers = trace.facts.map((_, i) => setTimeout(() => setTicked(i + 1), 1200 + i * 140));
    return () => timers.forEach(clearTimeout);
  }, [trace.facts]);
  const stat = (n: number, label: string, id: string) => (
    <div className="min-w-0">
      <div className="num text-[22px] font-semibold leading-none" data-testid={`funnel-${id}`} data-value={id === "searched" ? trace.searched : id === "relevant" ? trace.relevant : plans}>
        {n.toLocaleString()}
      </div>
      <div className="mt-1 text-[11.5px] text-ink-3">{label}</div>
    </div>
  );
  return (
    <section className="rounded-xl border border-line bg-surface px-3.5 py-3" aria-label="How the plans were found" data-testid="compose-funnel">
      <div className="flex items-center gap-3" aria-live="polite">
        {stat(searched, "services searched", "searched")}
        <span aria-hidden className="text-ink-3">→</span>
        {stat(relevant, "relevant", "relevant")}
        <span aria-hidden className="text-ink-3">→</span>
        {stat(built, built === 1 ? "plan" : "plans", "plans")}
      </div>
      {trace.facts.length > 0 && (
        <ul className="mt-2.5 space-y-1 border-t border-[#f1f0ec] pt-2 text-[12.5px]" aria-label="What it needs to find out">
          {trace.facts.map((f, i) => (
            <li key={f.id} className={`flex items-start gap-2 transition-opacity duration-200 ${i < ticked ? "opacity-100" : "opacity-0"}`} data-testid={`fact-${f.id}`} data-covered={f.covered ? "true" : "false"}>
              <span aria-hidden className={`mt-[1px] w-3 shrink-0 text-center font-semibold ${f.covered ? "text-good" : "text-ink-3"}`}>
                {f.covered ? "✓" : "–"}
              </span>
              <span className={f.covered ? "text-ink" : "text-ink-3"}>
                {f.question}
                {!f.covered && <span className="sr-only"> (no service found)</span>}
                {f.importance === "must" && <span className="ml-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">must</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
