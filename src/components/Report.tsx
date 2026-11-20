"use client";
import { useEffect, useRef, useState } from "react";
import { Tidy } from "./Tidy";
import type { Report as ReportT, Run } from "@/lib/types";
import { fmt } from "@/lib/money";
import { txUrl } from "@/lib/format";
import { Icon } from "./Icon";
import { Point, Points } from "./Points";

export const VERDICT: Record<NonNullable<ReportT["verdict"]>, { text: string; cls: string }> = {
  looks_fine: { text: "Looks fine", cls: "bg-good/10 text-good border-good/40" },
  be_careful: { text: "Be careful", cls: "bg-warn/20 text-warn-ink border-warn" },
  do_not_proceed: { text: "Don't go ahead", cls: "bg-bad/10 text-bad border-bad/40" },
  unclear: { text: "Not clear yet", cls: "bg-[#f1f0ec] text-ink-2 border-line" },
};

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫";

/** A numbered chip on a claim: opens what backs it (the step, the seller, the price, the transaction). */
function Evidence({ run, phaseId, n }: { run: Run; phaseId: string; n: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const p = run.phases.find((x) => x.id === phaseId);
  const line = run.lines.find((l) => l.id === p?.lineId);
  const pay = p?.payments.find((x) => x.txState === "settled");
  if (!p) return null;
  return (
    <span ref={ref} className="relative inline-block align-super">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={`Evidence ${n}: ${p.label}`} className="mx-[1px] rounded px-[1px] text-[12px] font-semibold leading-none text-agent-ink hover:bg-agent-soft" data-testid={`evidence-${phaseId}`}>
        {CIRCLED[n - 1] ?? `(${n})`}
      </button>
      {open && (
        <span role="dialog" className="absolute left-0 top-5 z-20 block w-64 rounded-xl border-[1.5px] border-ink bg-panel p-3 text-left text-[12.5px] leading-snug shadow-[3px_3px_0_0_var(--agent)]" data-testid="evidence-popover">
          <span className="block font-semibold text-ink">{p.label}</span>
          {line && <span className="mt-1 block text-ink-2">From {line.payeeName.replace(/ \(Agent Marketplace\)$/, "")}</span>}
          {line && <span className="num block text-ink-2">Paid ${fmt(line.actual)} USDC</span>}
          {p.finding && <span className="mt-1 block text-ink-3">Found: {p.finding.text}</span>}
          {pay?.txHash ? (
            <a href={txUrl(pay.txHash, run.network)} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 font-medium text-ink underline decoration-line underline-offset-2" data-testid="evidence-tx">
              Payment on Arc <Icon name="external" size={11} />
            </a>
          ) : (
            <span className="mt-1.5 block text-ink-3">{run.mode === "demo" ? "Practice: no money moved" : "Paid through Circle Gateway (settled in a batch)"}</span>
          )}
        </span>
      )}
    </span>
  );
}

/**
 * The write-up: one sentence, a verdict, what was found with the evidence behind each claim, where
 * sources disagreed and how that was settled, and what this didn't cover.
 */
const SIGNAL = {
  bad: { text: "Red flag", cls: "border-bad/50 bg-bad/5", label: "text-bad" },
  warn: { text: "Look closer", cls: "border-warn bg-warn/10", label: "text-warn-ink" },
  good: { text: "Reassuring", cls: "border-good/40 bg-good/5", label: "text-good" },
} as const;
const SIGNAL_ORDER = { bad: 0, warn: 1, good: 2 } as const;

export function Report({ run, id }: { run: Run; /** Set on the page made for printing. */ id?: string }) {
  const r = run.report;
  if (!r) return null;
  const v = r.verdict ? VERDICT[r.verdict] : null;
  const order = [...new Set([...r.claims.flatMap((c) => c.evidence), ...(r.signals ?? []).flatMap((x) => x.evidence)])];
  return (
    <section id={id} className="rounded-2xl border-[1.5px] border-ink bg-panel shadow-[4px_4px_0_0_var(--agent)]" aria-label="Report" data-testid="report">
      <div className="px-4 pb-3 pt-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-pixel text-[12px] text-agent-ink">Report</span>
          {v && (
            <span className={`rounded-md border px-2 py-0.5 text-[12.5px] font-semibold ${v.cls}`} data-testid="report-verdict" data-verdict={r.verdict}>
              {v.text}
            </span>
          )}
        </div>
        <h2 className="mt-1 text-[18px] font-semibold leading-snug" data-testid="report-headline">
          {r.headline}
        </h2>
      </div>
      {r.recommendation && (
        <div className="mx-4 mb-3 rounded-xl border-[1.5px] border-ink bg-agent-soft/60 px-3.5 py-3" data-testid="report-recommendation">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-agent-ink">What to do</span>
          <div className="mt-1">
            <Tidy text={r.recommendation} figures={false} />
          </div>
          {r.nextSteps && r.nextSteps.length > 0 && (
            <ol className="mt-2.5 grid gap-1.5">
              {r.nextSteps.map((n, i) => (
                <li key={n} className="flex items-start gap-2 text-[13px] leading-snug text-ink-2">
                  <span className="mt-px inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-[1.5px] border-ink bg-panel text-[11px] font-semibold text-ink">{i + 1}</span>
                  {n}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {r.signals && r.signals.length > 0 && (
        <div className="border-t border-[#f1f0ec] px-4 py-3" data-testid="report-signals">
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">Checked by fixed rules</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {[...r.signals].sort((a, b) => SIGNAL_ORDER[a.level] - SIGNAL_ORDER[b.level]).map((x) => (
              <div key={x.text} className={`rounded-xl border-[1.5px] px-3 py-2.5 ${SIGNAL[x.level].cls}`} data-testid="report-signal" data-level={x.level}>
                <span className={`text-[10.5px] font-semibold uppercase tracking-wide ${SIGNAL[x.level].label}`}>{SIGNAL[x.level].text}</span>
                <p className="mt-0.5 text-[13px] leading-snug">
                  {x.text}
                  {x.evidence.map((e) => (
                    <Evidence key={e} run={run} phaseId={e} n={order.indexOf(e) + 1 || order.length + 1} />
                  ))}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
      {r.claims.length > 0 && (
        <div className="border-t border-[#f1f0ec] px-4 py-3">
          <Points as="ul" layout="stack" aria-label="What was found">
            {r.claims.map((c, i) => (
              <Point key={i} as="li" size="sm" tone={c.unverified?.length ? "warn" : "agent"} data-testid="report-claim">
                {c.text}
                {c.evidence.map((e) => (
                  <Evidence key={e} run={run} phaseId={e} n={order.indexOf(e) + 1} />
                ))}
                {c.unverified?.length ? <span className="ml-1 text-[12px] text-warn-ink" title="These figures weren't in the data">(unchecked: {c.unverified.join(", ")})</span> : null}
              </Point>
            ))}
          </Points>
        </div>
      )}
      {r.conflicts.length > 0 && (
        <div className="mx-4 mb-3 space-y-2 rounded-xl border border-warn bg-warn/10 px-3 py-2.5 text-[13px]" data-testid="report-conflicts">
          {r.conflicts.map((c) => (
            <div key={c.fact}>
              <div className="font-semibold">{c.fact}</div>
              <div className="text-ink-2">{c.values.map((x) => `${x.source}: ${x.value}`).join(" · ")}</div>
              <div className="text-ink-2">
                {c.outcome}
                {c.resolvedBy ? ` Settled by ${c.resolvedBy}.` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
      {r.gaps.length > 0 && (
        <div className="border-t border-[#f1f0ec] px-4 py-3 text-[13px]" data-testid="report-gaps">
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">What this didn&apos;t cover</div>
          <Points as="ul" min={220} className="mt-1.5">
            {r.gaps.map((g) => (
              <Point key={g} as="li" size="sm" tone="muted" soft>
                <span className="text-ink-2">{g}</span>
              </Point>
            ))}
          </Points>
        </div>
      )}
      <p className="num border-t border-[#f1f0ec] px-4 py-2.5 text-[12.5px] text-ink-3" data-testid="report-spent">
        ${fmt(r.spent.total)} spent on {r.spent.sources} check{r.spent.sources === 1 ? "" : "s"} from {r.spent.sellers} seller{r.spent.sellers === 1 ? "" : "s"}
        {r.by === "ai" ? " · worded by the model, every claim checked by code" : ""}
      </p>
    </section>
  );
}
