"use client";
import type { Phase, Run } from "@/lib/types";
import { VERDICT_H, VERDICT_W } from "./layout";

const LEAN: Record<NonNullable<Run["verdict"]>["lean"], { text: string; cls: string }> = {
  looks_fine: { text: "Looks fine", cls: "text-good" },
  be_careful: { text: "Be careful", cls: "text-warn-ink" },
  do_not_proceed: { text: "Don't go ahead", cls: "text-bad" },
  unclear: { text: "Still checking", cls: "text-ink-2" },
};
const SEG: Record<NonNullable<Phase["finding"]>["tone"], string> = { good: "bg-good", warn: "bg-warn", bad: "bg-bad", neutral: "bg-ink/30" };

/** Where the lanes meet: the verdict so far, and a meter with one segment per finished lane step. Then the report's headline. */
export function VerdictNode({ run, x, y }: { run: Run; x: number; y: number }) {
  const lean = run.report?.verdict ?? run.verdict?.lean ?? "unclear";
  const steps = run.phases.filter((p) => p.lineId && p.lane && !p.gap && p.status !== "skipped");
  const flipped = Boolean(run.report);
  return (
    <div className="absolute [perspective:600px]" style={{ left: x, top: y, width: VERDICT_W, height: VERDICT_H }} data-testid="verdict-node" data-lean={lean}>
      <div key={flipped ? "report" : "tally"} className={`flex h-full flex-col rounded-xl border-[1.5px] border-ink bg-panel px-3 py-2.5 shadow-[3px_3px_0_0_var(--agent)] ${flipped ? "verdict-flip" : ""}`} aria-live="polite">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{flipped ? "Report" : "Verdict so far"}</span>
        <span className={`mt-0.5 text-[15px] font-semibold leading-tight ${LEAN[lean].cls}`}>{LEAN[lean].text}</span>
        {flipped ? (
          <>
            <span className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-ink-2">{run.report!.headline}</span>
            <a href="#report" className="mt-auto text-[11.5px] font-semibold text-agent-ink underline underline-offset-2">
              Read the report ↓
            </a>
          </>
        ) : (
          <div className="mt-auto flex gap-[3px]" aria-label="Findings so far" data-testid="verdict-meter">
            {steps.map((p) => (
              <span key={p.id} title={p.finding ? `${p.label}: ${p.finding.text}` : `${p.label}: waiting`} className={`h-2 flex-1 rounded-[2px] transition-colors duration-300 ${p.finding ? SEG[p.finding.tone] : "bg-[#e3e2dc]"}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
