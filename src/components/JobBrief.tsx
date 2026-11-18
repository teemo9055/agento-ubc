"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Phase, Run } from "@/lib/types";
import { paidInUsdc } from "@/lib/types";
import { fmt, sum } from "@/lib/money";
import { outcomeOf } from "@/lib/outcome";
import { risksOf } from "@/lib/risks";
import { getsLine } from "@/lib/plain";
import { VenueBadge } from "./Chat";
import { Button, Spinner } from "./ui";
import { Icon } from "./Icon";
import { post } from "./useRun";
import { toast } from "./Toaster";

const TONE = {
  good: "border-good/60 bg-good/[0.06]",
  warn: "border-warn bg-warn/10",
  bad: "border-bad/50 bg-bad/[0.06]",
  info: "border-ink bg-panel",
} as const;
const DOT = { good: "bg-good", warn: "bg-warn", bad: "bg-bad", info: "bg-agent" } as const;

const orderCost = (run: Run) => {
  const a = run.proposal?.action;
  if (!a || a.kind === "itinerary") return 0;
  return a.kind === "prediction_order" ? (a.trade === "sell" ? 0 : a.maxPrice * a.quantity) : a.amountUsd;
};

function StepRow({ p, run, n }: { p: Phase; run: Run; n: number }) {
  const line = run.lines.find((l) => l.id === p.lineId);
  const paid = line && paidInUsdc(line.rail);
  const mark =
    p.status === "done" ? (
      <Icon name="check" size={13} stroke={2.6} className="text-good" />
    ) : p.status === "skipped" ? (
      <span className="text-ink-3">–</span>
    ) : p.status === "active" ? (
      <Spinner />
    ) : p.status === "failed_waiting" || p.status === "awaiting_reapproval" ? (
      <span className="font-bold text-warn-ink">!</span>
    ) : (
      <span className="num text-[11px] text-ink-3">{n}</span>
    );
  return (
    <li className="flex items-start gap-2.5 py-1.5" data-testid="brief-step">
      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-line bg-surface">{mark}</span>
      <span className="min-w-0 flex-1">
        <span className={`text-[14px] ${p.status === "skipped" ? "text-ink-3 line-through" : "font-medium"}`}>{p.label}</span>
        {line?.bigSpend && paid && (run.status === "draft" || run.status === "funding") && (
          <span className="ml-2 rounded-md bg-warn/20 px-1.5 py-0.5 text-[10.5px] font-medium text-warn-ink" title="Above your big-purchase threshold in Settings; approving covers it">
            Big purchase
          </span>
        )}
        <span className="block truncate text-[12.5px] text-ink-3">{p.status === "planned" || !p.note ? p.sub : p.note}</span>
      </span>
      {line && (
        <span className="num shrink-0 text-[12.5px] text-ink-2">
          {paid ? `${fmt(run.status === "draft" || run.status === "funding" ? line.approved : line.actual)} USDC` : line.rail === "exchange" && Number(line.approved) > 0 ? `up to $${(Number(line.approved) / 1e6).toFixed(2)}` : ""}
        </span>
      )}
    </li>
  );
}

/** Before approval: what will happen, in order, and the most it can cost. Nothing else. */
export function ReviewCard({ run }: { run: Run }) {
  const p = run.proposal;
  const data = sum(run.lines.filter((l) => paidInUsdc(l.rail)).map((l) => l.approved));
  const order = orderCost(run);
  const trade = p?.action && p.action.kind !== "itinerary";
  const risks = risksOf(run);
  const gets = p ? getsLine(p) : undefined;
  // What the person asked for, in their own words. A step of a plan was asked for by the plan, not typed by them.
  const want = run.parentId ? undefined : run.task.trim();
  const Part = ({ title, children, testid }: { title: string; children: React.ReactNode; testid: string }) => (
    <div className="border-t border-[#f1f0ec] px-4 py-3" data-testid={testid}>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{title}</div>
      {children}
    </div>
  );
  return (
    <section className="rounded-2xl border-[1.5px] border-ink bg-panel shadow-[4px_4px_0_0_var(--agent)]" aria-label="Review" data-testid="review-card">
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3.5">
        <div className="min-w-0">
          <div className="font-pixel text-[12px] text-agent-ink">Review</div>
          <h2 className="mt-0.5 text-[16px] font-semibold leading-snug">{p?.ask ?? run.task}</h2>
        </div>
        {trade && <VenueBadge venue={p?.venue ?? "paper"} />}
      </div>
      {want && (
        <Part title="You asked for" testid="review-want">
          <p className="text-[14px] leading-snug text-ink">“{want.length > 180 ? `${want.slice(0, 177)}…` : want}”</p>
        </Part>
      )}
      <Part title="What happens" testid="review-steps">
        <ol aria-label="What happens">
          {run.phases.map((ph, i) => (
            <StepRow key={ph.id} p={ph} run={run} n={i + 1} />
          ))}
        </ol>
        {p?.hedge && (
          <p className="mt-1 rounded-lg bg-agent-soft px-3 py-2 text-[13px] text-ink" data-testid="hedge-line">
            This is insurance for {p.hedge.protects}.{" "}
            {p.hedge.covered < p.hedge.lossUsd - 0.5 ? `It covers about $${Math.round(p.hedge.covered)} of your $${p.hedge.lossUsd}. ` : ""}
            If it doesn&apos;t happen, the ${p.hedge.cost.toFixed(2)} is what the cover cost you.
          </p>
        )}
      </Part>
      {risks.length > 0 && (
        <Part title="If something goes wrong" testid="review-risks">
          <ul className="space-y-1.5">
            {risks.map((r) => (
              <li key={r.if} className="text-[13.5px] leading-snug" data-testid="review-risk">
                <span className="font-semibold text-ink">{r.if}:</span> <span className="text-ink-2">{r.then}</span>
              </li>
            ))}
          </ul>
        </Part>
      )}
      <Part title="Most this can cost" testid="review-total">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <span className="num text-[16px] font-semibold" data-testid="review-cost">
            {data > 0n || order === 0 ? `${fmt(data)} USDC for data` : ""}
            {data > 0n && order > 0 ? " + " : ""}
            {order > 0 ? `$${order.toFixed(2)} order` : ""}
          </span>
          {gets && p?.action && (
            <span className="text-[13.5px] text-ink-2" data-testid="review-gets">
              You get: <span className="font-semibold text-ink">{gets.label}</span>
            </span>
          )}
        </div>
        <p className="mt-1 text-[12.5px] text-ink-3">
          {data > 0n ? "The data money sits in a vault that can only pay these steps; what isn't used comes back. " : ""}
          {order > 0 ? (p?.venue === "paper" ? "No exchange is connected, so the order is practice only." : "The order is paid on the exchange.") : ""}
        </p>
      </Part>
    </section>
  );
}

/** After approval: one line on where the job stands, the steps as a checklist, and what you can do next. */
export function StatusCard({ run, onNeedsYou, onCancel }: { run: Run; onNeedsYou?: () => void; onCancel?: () => void }) {
  const router = useRouter();
  const out = outcomeOf(run);
  const o = run.order;
  const [busy, setBusy] = useState("");
  const finished = run.status === "done" || run.status === "cancelled";
  const liveOrder = o?.status === "open" && o.venue !== "paper";
  const needs = run.pendingFailures.length + run.pendingReapprovals.length;

  // Keep an open order current without the user asking.
  useEffect(() => {
    if (!liveOrder) return;
    const t = setInterval(() => void post(`/api/runs/${run.id}/order-refresh`).catch(() => undefined), 20_000);
    return () => clearInterval(t);
  }, [liveOrder, run.id]);

  async function act(kind: "order-refresh" | "order-cancel" | "rerun" | "save") {
    setBusy(kind);
    try {
      if (kind === "rerun") {
        const r = await post<{ run: Run; fresh: boolean; why?: string }>(`/api/runs/${run.id}/rerun`);
        toast(r.fresh ? "Same move, today's prices · review and approve" : r.why ? `That move no longer works (${r.why}) · asking again` : "Asking again", r.fresh ? "good" : "default");
        router.push(`/runs/${r.run.id}`);
        return;
      }
      await post(`/api/runs/${run.id}/${kind}`, kind === "save" ? { saved: !run.saved } : undefined);
      if (kind === "order-cancel") toast("Order cancelled", "good");
      if (kind === "save") toast(run.saved ? "Removed from Saved" : "Saved · find it under Saved on the Jobs page", "good");
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className={`rounded-2xl border-[1.5px] ${TONE[out.tone]}`} aria-label="Status" data-testid="status-card">
      <div className="px-4 py-3.5">
        <div className="flex items-start gap-2.5">
          <span className={`mt-[7px] h-2.5 w-2.5 shrink-0 rounded-[3px] ${DOT[out.tone]} ${!finished && !needs ? "animate-pulse motion-reduce:animate-none" : ""}`} aria-hidden />
          <div className="min-w-0 flex-1" aria-live="polite">
            <h2 className="text-[18px] font-semibold leading-snug" data-testid="status-headline">
              {out.headline}
            </h2>
            {out.detail && (
              <p className="mt-0.5 text-[13.5px] leading-snug text-ink-2" data-testid="status-detail">
                {out.detail}
              </p>
            )}
            {o?.updatedAt && liveOrder && <p className="num mt-1 text-[12px] text-ink-3">Checked {new Date(o.updatedAt).toLocaleTimeString()} · order #{o.orderId}</p>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {needs > 0 && onNeedsYou && (
            <Button variant="agent" className="h-9" onClick={onNeedsYou}>
              {needs} needs you
            </Button>
          )}
          {liveOrder && (
            <>
              <Button variant="ghost" className="h-9" disabled={!!busy} onClick={() => act("order-refresh")} data-testid="order-refresh">
                {busy === "order-refresh" ? <Spinner /> : null} Check now
              </Button>
              <Button variant="danger" className="h-9" disabled={!!busy} onClick={() => act("order-cancel")} data-testid="order-cancel">
                {busy === "order-cancel" ? <Spinner /> : null} Cancel order
              </Button>
            </>
          )}
          {o?.status === "simulated" && (
            <Link href="/settings" className="pressable inline-flex h-9 items-center rounded-lg border border-line bg-panel px-3 text-[13px] font-medium">
              Connect an exchange
            </Link>
          )}
          {finished && (
            <>
              <Button variant="ghost" className="h-9" disabled={!!busy} onClick={() => act("rerun")} data-testid="run-again">
                {busy === "rerun" ? <Spinner /> : <Icon name="refund" size={15} />} Run again
              </Button>
              <Button variant="ghost" className="h-9" disabled={!!busy} onClick={() => act("save")} aria-pressed={Boolean(run.saved)} data-testid="save-job">
                {run.saved ? "Saved ✓" : "Save"}
              </Button>
            </>
          )}
          {!finished && onCancel && (
            <Button variant="quiet" className="h-9" onClick={onCancel}>
              Cancel job
            </Button>
          )}
        </div>
      </div>
      {run.handoff && (
        <p className="border-t border-[#f1f0ec] px-4 py-2.5 text-[12.5px] text-ink-2" data-testid="handoff">
          <span className="font-semibold text-ink">Handed over from earlier steps:</span> {run.handoff}
        </p>
      )}
      <ol className="border-t border-[#f1f0ec] px-4 py-2" aria-label="Steps">
        {run.phases.map((ph, i) => (
          <StepRow key={ph.id} p={ph} run={run} n={i + 1} />
        ))}
      </ol>
      {run.deliverable?.notes && run.deliverable.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 border-t border-[#f1f0ec] py-3 pl-9 pr-4 text-[13.5px] text-ink-2" data-testid="findings">
          {run.deliverable.notes.slice(0, 4).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The full graph, cost lines and cards: there if you want them, out of the way if you don't. */
export function Details({ label, children, open, onToggle }: { label: string; children: React.ReactNode; open: boolean; onToggle: () => void }) {
  return (
    <section className="rounded-2xl border border-line bg-panel/70" aria-label="Details">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-[13.5px] font-medium text-ink-2 hover:text-ink" data-testid="details-toggle">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="chevron" size={14} className={`transition-transform ${open ? "rotate-90" : ""}`} /> {label}
        </span>
        <span className="text-[12px] font-normal text-ink-3">{open ? "Hide" : "Show"}</span>
      </button>
      {open && <div className="space-y-5 border-t border-[#f1f0ec] p-4">{children}</div>}
    </section>
  );
}
