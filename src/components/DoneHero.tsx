"use client";
import { useState } from "react";
import type { Run } from "@/lib/types";
import { post } from "./useRun";
import { toast } from "./Toaster";
import { Spinner } from "./ui";
import { VERDICT } from "./Report";
import { outcomeOf } from "@/lib/outcome";

const ANSWER = {
  answered: { text: "Answered", cls: "bg-good/10 text-good" },
  partly: { text: "Partly", cls: "bg-warn/15 text-warn-ink" },
  not_found: { text: "Not found", cls: "bg-ink/5 text-ink-3" },
} as const;

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
      {/* The questions the job set out to answer, each answered or plainly marked not found. */}
      {r.answers && r.answers.length > 0 && (
        <div className="mt-5 grid gap-2.5 sm:grid-cols-2" data-testid="answers">
          {r.answers.map((a, i) => (
            <div key={a.id} className={`rounded-xl border-[1.5px] bg-surface px-3.5 py-3 ${a.status === "not_found" ? "border-dashed border-line" : "border-ink/80"}`} data-testid={`answer-${a.id}`} data-status={a.status}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11.5px] font-semibold tracking-wide text-ink-3">QUESTION {i + 1}</span>
                <span className={`rounded-full px-2 py-[1px] text-[11.5px] font-semibold ${ANSWER[a.status].cls}`}>
                  {ANSWER[a.status].text}
                  {a.confidence && a.status !== "not_found" ? ` · ${a.confidence}` : ""}
                </span>
              </div>
              <div className="mt-1 text-[14px] font-semibold leading-snug">{a.ask}</div>
              <p className="mt-1 text-[14px] leading-snug text-ink-2">{a.text}</p>
              {a.soWhat && <p className="mt-1.5 text-[13px] font-medium text-agent-ink">{a.soWhat}</p>}
            </div>
          ))}
        </div>
      )}
      {r.beyondSearch && (
        <div className="mt-3 flex items-start gap-2.5 rounded-xl bg-agent-soft px-3.5 py-2.5 text-[14px] leading-snug" data-testid="beyond-search">
          <span className="shrink-0 font-pixel text-[10px] leading-5 text-agent-ink">PAID DATA</span>
          <span>{r.beyondSearch}</span>
        </div>
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
      <PlaceAnyway run={run} />
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

/**
 * The checks said wait, but it's the person's call: one button places the approved prediction order
 * on Gemini anyway (same contract, price and size), through the prediction-market API.
 */
function PlaceAnyway({ run }: { run: Run }) {
  const [busy, setBusy] = useState(false);
  const a = run.proposal?.action;
  const act = run.phases.find((p) => p.id === "act");
  const held = run.status === "done" && a?.kind === "prediction_order" && a.trade !== "sell" && (!run.order || run.order.status === "skipped" || act?.status === "skipped");
  if (!held || a?.kind !== "prediction_order") return null;
  const where = run.proposal?.venue === "gemini" ? "Gemini (real money)" : run.proposal?.venue === "gemini-sandbox" ? "Gemini's test exchange" : "practice";
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border-[1.5px] border-dashed border-ink/50 px-3.5 py-3" data-testid="place-anyway-box">
      <div className="min-w-0 text-[13.5px] leading-snug text-ink-2">
        <span className="font-semibold text-ink">No order went in.</span> The checks said wait. It&apos;s your call: place {a.quantity} × {a.side.toUpperCase()} at {Math.round(a.maxPrice * 100)}¢ or less on {where} anyway.
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await post(`/api/runs/${run.id}/place-anyway`);
            toast("Sent to Gemini's prediction market");
          } catch (e) {
            toast((e as Error).message, "bad");
          } finally {
            setBusy(false);
          }
        }}
        className="pressable inline-flex h-10 shrink-0 items-center gap-2 rounded-full border-[1.5px] border-ink bg-ink px-4 text-[13.5px] font-semibold text-white hover:bg-agent hover:text-agent-on disabled:opacity-50"
        data-testid="place-anyway"
      >
        {busy ? <Spinner /> : null} Place it anyway
      </button>
    </div>
  );
}
