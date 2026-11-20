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
  const steps = (r.nextSteps?.length ? r.nextSteps : r.recommendation ? [r.recommendation] : []).slice(0, 3);
  const warnings = (r.signals ?? []).filter((s) => s.level !== "good").slice(0, 2);
  // How an order or trip ended, unless it only repeats the headline.
  const status = run.proposal?.action ? outcomeOf(run).headline : undefined;
  const showStatus = status && status.trim() !== r.headline.trim();
  const notes = [...warnings.map((w) => ({ key: w.text, text: w.text, tone: w.level === "bad" ? "bad" : "warn" })), ...(r.beyondSearch ? [{ key: "paid", text: r.beyondSearch, tone: "paid" }] : [])];
  return (
    <section aria-label="The answer" className="rounded-[22px] border-[1.5px] border-ink bg-panel p-5 shadow-[6px_6px_0_0_var(--agent)] sm:p-6" data-testid="done-hero">
      {/* 1. The verdict and one sentence. */}
      <div className="flex flex-wrap items-center gap-2">
        {v && (
          <span className={`inline-flex h-[26px] items-center rounded-lg border px-2.5 text-[12.5px] font-bold uppercase tracking-wide ${v.cls}`} data-testid="report-verdict" data-verdict={r.verdict}>
            {v.text}
          </span>
        )}
        {showStatus && (
          <span className="inline-flex min-h-[26px] items-center rounded-lg bg-ink/5 px-2.5 text-[13px] font-medium text-ink-2" data-testid="status-headline">
            {status}
          </span>
        )}
      </div>
      <h1 className="mt-2.5 text-[21px] font-bold leading-snug tracking-tight sm:text-[23px]" data-testid="report-headline">
        {r.headline}
      </h1>

      {/* 2. Each question, one compact row. */}
      {r.answers && r.answers.length > 0 && (
        <div className="mt-4 divide-y divide-line overflow-hidden rounded-xl border-[1.5px] border-ink/80" data-testid="answers">
          {r.answers.map((a, i) => (
            <div key={a.id} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 bg-surface px-3.5 py-3" data-testid={`answer-${a.id}`} data-status={a.status}>
              <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-[7px] border-[1.5px] border-ink text-[12px] font-bold">{i + 1}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-[14px] font-semibold leading-snug">{a.ask}</span>
                  <span className={`shrink-0 rounded-full px-2 py-[1px] text-[11.5px] font-semibold ${ANSWER[a.status].cls}`}>{ANSWER[a.status].text}</span>
                </div>
                <p className="mt-1 line-clamp-3 text-[13.5px] leading-snug text-ink-2">{a.text}</p>
                {a.soWhat && <p className="mt-1 text-[12.5px] font-semibold text-agent-ink">→ {a.soWhat}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 3. Worth knowing: the red flags and what the paid data added, side by side. */}
      {notes.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {notes.map((n) => (
            <div key={n.key} className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] leading-snug ${n.tone === "bad" ? "bg-bad/5 text-bad" : n.tone === "warn" ? "bg-warn/15 text-warn-ink" : "bg-agent-soft text-ink"}`} data-testid={n.tone === "paid" ? "beyond-search" : undefined}>
              <span className={`shrink-0 font-pixel text-[9.5px] leading-5 ${n.tone === "paid" ? "text-agent-ink" : ""}`}>{n.tone === "paid" ? "PAID DATA" : "HEADS UP"}</span>
              <span className="line-clamp-3">{n.text}</span>
            </div>
          ))}
        </div>
      )}

      <PlaceAnyway run={run} />

      {/* 4. What to do next. */}
      {steps.length > 0 && (
        <div className="mt-4 border-t border-dashed border-line pt-3.5">
          <div className="text-[12px] font-semibold tracking-wide text-ink-3">WHAT TO DO</div>
          <ol className="mt-2 grid gap-1.5">
            {steps.map((n, i) => (
              <li key={n} className="flex items-start gap-2.5 text-[14px] leading-snug">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-ink text-[11px] font-bold text-white">{i + 1}</span>
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
