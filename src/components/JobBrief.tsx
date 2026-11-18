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

function StepRow({ p, run, n, as = "li" }: { p: Phase; run: Run; n: number; as?: "li" | "div" }) {
  const Row = as;
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
    <Row className="flex items-start gap-2.5 py-1.5" data-testid="brief-step">
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
          {paid ? `$${fmt(run.status === "draft" || run.status === "funding" ? line.approved : line.actual)}` : line.rail === "exchange" && Number(line.approved) > 0 ? `up to $${(Number(line.approved) / 1e6).toFixed(2)}` : ""}
        </span>
      )}
    </Row>
  );
}

/** The steps as a numbered list; while it can still change, each step is a button that hands it to the chat. */
function Steps({ run, editable, onEditStep, focusedStep }: { run: Run; editable?: string[]; onEditStep?: (id: string) => void; focusedStep?: string | null }) {
  return (
    <ol aria-label="What happens" className="space-y-0.5">
      {run.phases.map((ph, i) =>
        onEditStep && (!editable || editable.includes(ph.id)) ? (
          <li key={ph.id}>
            <button
              type="button"
              onClick={() => onEditStep(ph.id)}
              aria-pressed={focusedStep === ph.id}
              aria-label={`Step ${i + 1}: ${ph.label}. Change it in the chat`}
              data-testid={`phase-${ph.id}`}
              className={`pressable -mx-2 block w-[calc(100%+16px)] rounded-lg px-2 text-left transition-colors ${focusedStep === ph.id ? "bg-agent-soft" : "hover:bg-ink/[0.04]"}`}
            >
              <StepRow p={ph} run={run} n={i + 1} as="div" />
            </button>
          </li>
        ) : (
          <StepRow key={ph.id} p={ph} run={run} n={i + 1} />
        ),
      )}
    </ol>
  );
}

/**
 * Before approval, the top of the page: the title of what will be done, what happens as numbered
 * steps, and the approve button. Everything else is in the cards below.
 */
export function ReviewCard({ run, actions, editable, onEditStep, focusedStep }: { run: Run; actions?: React.ReactNode; editable?: string[]; onEditStep?: (id: string) => void; focusedStep?: string | null }) {
  const p = run.proposal;
  const trade = p?.action && p.action.kind !== "itinerary";
  return (
    <section className="rounded-2xl border-[1.5px] border-ink bg-panel shadow-[4px_4px_0_0_var(--agent)]" aria-label="Review" data-testid="review-card">
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3.5">
        <div className="min-w-0">
          <div className="font-pixel text-[12px] text-agent-ink">Review</div>
          <h2 className="mt-0.5 text-[18px] font-semibold leading-snug" data-testid="review-title">
            {p?.title ?? run.task}
          </h2>
        </div>
        {trade && <VenueBadge venue={p?.venue ?? "paper"} />}
      </div>
      <div className="px-4 pb-3 pt-2" data-testid="review-steps">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">What happens</div>
        <Steps run={run} editable={editable} onEditStep={onEditStep} focusedStep={focusedStep} />
      </div>
      {actions && <div className="border-t border-[#f1f0ec] px-4 py-3">{actions}</div>}
    </section>
  );
}

const money = (x: number) => `$${x > 0 && x < 0.01 ? x.toFixed(4) : x.toFixed(2)}`;
const GENERIC = /^(The data seller doesn't answer|A data seller doesn't answer|A seller sends an empty or wrong answer|Something is left over)/;

/** The four answers under the review: what you get, how, the limits and the price. Each can be changed in the chat. */
export function ReviewCards({ run, onEdit, focused }: { run: Run; onEdit?: (k: "deliverable" | "method" | "risk" | "price") => void; focused?: string | null }) {
  const p = run.proposal;
  const gets = p ? getsLine(p) : undefined;
  const paid = run.lines.filter((l) => paidInUsdc(l.rail));
  const exchange = run.lines.filter((l) => l.rail === "exchange");
  const data = Number(sum(paid.map((l) => l.approved))) / 1e6;
  const risks = risksOf(run);
  const specific = risks.filter((r) => !GENERIC.test(r.if));
  const cards: { kind: "deliverable" | "method" | "risk" | "price"; title: string; body: React.ReactNode }[] = [
    {
      kind: "deliverable",
      title: "What you get",
      body: (
        <>
          <p className="text-[14px] font-semibold leading-snug">{gets?.label ?? "The answer"}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{gets?.detail}</p>
          {p?.hedge && (
            <p className="mt-1.5 text-[13px] leading-snug text-ink-2" data-testid="hedge-line">
              Insurance for {p.hedge.protects}. If it doesn&apos;t happen, the ${p.hedge.cost.toFixed(2)} is what the cover cost you.
            </p>
          )}
        </>
      ),
    },
    {
      kind: "method",
      title: "How (pay per request)",
      body: (
        <ul className="space-y-1 text-[13px] leading-snug">
          {paid.map((l) => (
            <li key={l.id} className="flex justify-between gap-2">
              <span className="min-w-0">
                <span className="font-medium">{run.phases.find((ph) => ph.lineId === l.id)?.label ?? l.purpose}</span> <span className="text-ink-3">from {l.payeeName}</span>
              </span>
              <span className="num shrink-0 text-ink-2">{money(Number(l.approved) / 1e6)}</span>
            </li>
          ))}
          {exchange.map((l) => (
            <li key={l.id} className="flex justify-between gap-2">
              <span className="min-w-0">
                <span className="font-medium">The order</span> <span className="text-ink-3">{p?.venue === "paper" ? "(practice, never sent)" : `on ${l.payeeName}`}</span>
              </span>
              <span className="num shrink-0 text-ink-2">up to {money(Number(l.approved) / 1e6)}</span>
            </li>
          ))}
          {!paid.length && !exchange.length && <li className="text-ink-2">Only free lookups: nothing is bought.</li>}
        </ul>
      ),
    },
    {
      kind: "risk",
      title: "Limits",
      body: (
        <ul className="space-y-1.5 text-[13px] leading-snug" data-testid="review-risks">
          {specific.map((r) => (
            <li key={r.if} data-testid="review-risk">
              <span className="font-semibold">{r.if}:</span> <span className="text-ink-2">{r.then}</span>
            </li>
          ))}
          {paid.length > 0 && (
            <li data-testid="review-risk">
              <span className="font-semibold">If a step fails:</span>{" "}
              <span className="text-ink-2">it stops and asks you to try again, skip or stop. A seller that sends nothing usable is refunded. What isn&apos;t spent comes back.</span>
            </li>
          )}
          {!specific.length && !paid.length && <li className="text-ink-2">Nothing is spent, so nothing can be lost.</li>}
        </ul>
      ),
    },
    {
      kind: "price",
      title: "Price",
      body: (
        <>
          <p className="num text-[18px] font-semibold">{data > 0 ? money(data) : "Free"}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-ink-2">
            {data > 0 ? `for ${paid.length} paid ${paid.length === 1 ? "lookup" : "lookups"}, paid one request at a time. Network fees are a fraction of a cent, paid by Agento.` : "This job buys no data."}
          </p>
        </>
      ),
    },
  ];
  return (
    <ul className="grid gap-3 sm:grid-cols-2" aria-label="About this job">
      {cards.map((c) => {
        const on = focused === c.kind;
        return (
          <li key={c.kind} className="min-w-0">
            <div className={`h-full rounded-2xl border bg-panel p-3.5 transition-[border-color,box-shadow] ${on ? "border-[1.5px] border-ink shadow-[3px_3px_0_0_var(--agent)]" : "border-line"} ${c.kind === "price" ? "bg-agent-soft" : ""}`} data-testid={`card-${c.kind}`} aria-pressed={onEdit ? on : undefined}>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">{c.title}</h3>
                {onEdit && (
                  <button type="button" onClick={() => onEdit(c.kind)} aria-pressed={on} aria-label={`Change ${c.title.toLowerCase()} in the chat`} className="pressable inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink" data-testid={`edit-${c.kind}`}>
                    <Icon name={on ? "chat" : "edit"} size={12} /> {on ? "In chat" : "Change"}
                  </button>
                )}
              </div>
              {c.body}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Below the cards: the most this can take from you, in dollars, with the split on tap. */
export function ReviewTotal({ run }: { run: Run }) {
  const data = sum(run.lines.filter((l) => paidInUsdc(l.rail)).map((l) => l.approved));
  const order = orderCost(run);
  const most = Number(data) / 1e6 + order;
  return (
    <section className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 rounded-2xl border border-line bg-panel px-4 py-3" aria-label="Total" data-testid="review-total">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Total</div>
        <div className="num text-[20px] font-semibold" data-testid="review-most">
          At most {money(most)}
        </div>
      </div>
      <details className="text-[13px] text-ink-2">
        <summary className="cursor-pointer list-none underline decoration-line underline-offset-2 [&::-webkit-details-marker]:hidden">What&apos;s in it</summary>
        <p className="num mt-1" data-testid="review-cost" data-usdc={fmt(data)}>
          {data > 0n || order === 0 ? `$${fmt(data)} for data` : ""}
          {data > 0n && order > 0 ? " + " : ""}
          {order > 0 ? `$${order.toFixed(2)} order` : ""}
        </p>
        <p className="mt-0.5 text-[12.5px] text-ink-3">
          {data > 0n ? "What isn't used comes back when the job ends. " : ""}
          {order > 0 ? (run.proposal?.venue === "paper" ? "Practice: the order is never sent." : "The order is paid on the exchange, only if it fills.") : ""}
        </p>
      </details>
    </section>
  );
}

/** After approval: one line on where the job stands, the steps as a checklist, and what you can do next. */
export function StatusCard({ run, onNeedsYou, onCancel, steps = true }: { run: Run; onNeedsYou?: () => void; onCancel?: () => void; /** The checklist of steps; off where the graph already shows them. */ steps?: boolean }) {
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
            {out.detail && !out.headline.toLowerCase().includes(out.detail.toLowerCase()) && (
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
      {steps && (
        <ol className="border-t border-[#f1f0ec] px-4 py-2" aria-label="Steps">
          {run.phases.map((ph, i) => (
            <StepRow key={ph.id} p={ph} run={run} n={i + 1} />
          ))}
        </ol>
      )}
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
