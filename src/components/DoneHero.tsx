"use client";
import type { Run } from "@/lib/types";
import { VERDICT } from "./Report";
import { outcomeOf } from "@/lib/outcome";

/**
 * A finished job's answer, first and alone: the verdict, one sentence, and what to do. Everything
 * that backs it up (stages, sources, payments) is folded below it.
 */
export function DoneHero({ run }: { run: Run }) {
  const r = run.report;
  if (!r) return null;
  const v = r.verdict ? VERDICT[r.verdict] : null;
  const steps = r.nextSteps?.length ? r.nextSteps : r.recommendation ? [r.recommendation] : [];
  const warnings = (r.signals ?? []).filter((s) => s.level !== "good");
  return (
    <section aria-label="The answer" className="rounded-[22px] border-[1.5px] border-ink bg-panel p-5 shadow-[6px_6px_0_0_var(--agent)] sm:p-7" data-testid="done-hero">
      {v && (
        <span className={`inline-flex h-[26px] items-center rounded-lg border px-2.5 text-[12.5px] font-bold uppercase tracking-wide ${v.cls}`} data-testid="report-verdict" data-verdict={r.verdict}>
          {v.text}
        </span>
      )}
      <h1 className="mt-2.5 text-[24px] font-bold leading-tight tracking-tight sm:text-[28px]" data-testid="report-headline">
        {r.headline}
      </h1>
      {/* For an order or a trip, how it ended is part of the answer: one line. */}
      {run.proposal?.action && (
        <p className="mt-2 text-[14.5px] font-medium text-ink-2" data-testid="status-headline">
          {outcomeOf(run).headline}
        </p>
      )}
      {warnings.length > 0 && (
        <div className="mt-4 grid gap-2">
          {warnings.slice(0, 2).map((s) => (
            <div key={s.text} className={`flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-[14px] leading-snug ${s.level === "bad" ? "bg-bad/5 text-bad" : "bg-warn/15 text-warn-ink"}`}>
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-[3px] ${s.level === "bad" ? "bg-bad" : "bg-warn"}`} aria-hidden />
              {s.text}
            </div>
          ))}
        </div>
      )}
      {steps.length > 0 && (
        <div className="mt-5 border-t border-dashed border-line pt-4">
          <div className="text-[12px] font-semibold tracking-wide text-ink-3">WHAT TO DO</div>
          <ol className="mt-2.5 grid gap-2">
            {steps.map((n, i) => (
              <li key={n} className="flex items-start gap-2.5 text-[15px] leading-snug">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border-[1.5px] border-ink text-[12px] font-bold">{i + 1}</span>
                {n}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
