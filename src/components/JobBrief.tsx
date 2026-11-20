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
import { Point, Points } from "./Points";
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

function StepRow({ p, run, n, as = "li", price = true }: { p: Phase; run: Run; n: number; as?: "li" | "div"; /** Off where the cost section lists the prices. */ price?: boolean }) {
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
      {line && price && (
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
              <StepRow p={ph} run={run} n={i + 1} as="div" price={false} />
            </button>
          </li>
        ) : (
          <StepRow key={ph.id} p={ph} run={run} n={i + 1} price={false} />
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
// Said elsewhere on the review (the practice badge, the cost, the failure line below), so not repeated here.
const GENERIC = /^(The data seller doesn't answer|A data seller doesn't answer|A seller sends an empty or wrong answer|Something is left over|No exchange is connected)/;

/** The four answers under the review: what you get, how, the limits and the price. Each can be changed in the chat. */
export function ReviewCards({ run, onEdit, focused }: { run: Run; onEdit?: (k: "deliverable" | "method" | "risk" | "price") => void; focused?: string | null }) {
  const p = run.proposal;
  const gets = p ? getsLine(p) : undefined;
  const paid = run.lines.filter((l) => paidInUsdc(l.rail));
  const exchange = run.lines.filter((l) => l.rail === "exchange");
  const data = Number(sum(paid.map((l) => l.approved))) / 1e6;
  const risks = risksOf(run);
  const specific = risks.filter((r) => !GENERIC.test(r.if));
  const yours = run.phases.filter((ph) => ph.finish);
  // Steps that only run if an earlier answer calls for it, or if two sources disagree: listed apart, with their most.
  const maybeOf = (l: (typeof paid)[number]) => run.phases.find((ph) => ph.lineId === l.id && (ph.conditional || ph.tieBreaker));
  const always = paid.filter((l) => !maybeOf(l));
  const maybe = paid.filter((l) => maybeOf(l));
  const gaps = run.phases.filter((ph) => ph.gap);
  const cards: { kind: "deliverable" | "method" | "risk"; title: string; sub: string; body: React.ReactNode }[] = [
    {
      kind: "deliverable",
      title: "Outcome",
      sub: "What you receive",
      body: (
        <>
          <p className="text-[14px] font-semibold leading-snug">{gets?.label ?? "The answer"}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{gets?.detail}</p>
          {p?.hedge && (
            <p className="mt-1.5 text-[13px] leading-snug text-ink-2" data-testid="hedge-line">
              Insurance for {p.hedge.protects}. If it doesn&apos;t happen, the ${p.hedge.cost.toFixed(2)} is what the cover cost you.
            </p>
          )}
          {gaps.length > 0 && (
            <div className="mt-2 border-t border-[#f1f0ec] pt-2" data-testid="review-gaps">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">What it can&apos;t answer</p>
              <Points as="ul" layout="stack" className="mt-1.5">
                {gaps.map((g) => (
                  <Point key={g.id} as="li" size="sm" tone="muted" soft title={g.gap!.fact}>
                    {g.gap!.why}
                  </Point>
                ))}
              </Points>
            </div>
          )}
        </>
      ),
    },
    {
      kind: "method",
      title: "Execution",
      sub: "Paid per request",
      body: (
        <ol className="space-y-1.5 text-[13px] leading-snug">
          {always.map((l, i) => (
            <li key={l.id} className="flex gap-2">
              <span className="num shrink-0 text-ink-3">{i + 1}.</span>
              <span className="min-w-0">
                <span className="font-medium">{run.phases.find((ph) => ph.lineId === l.id)?.label ?? l.purpose}</span>
                <span className="block text-ink-3">from {l.payeeName}</span>
              </span>
            </li>
          ))}
          {maybe.length > 0 && (
            <li className="rounded-lg border border-dashed border-line px-2 py-1.5" data-testid="review-maybe">
              <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">Only if needed · at most {money(Number(sum(maybe.map((l) => l.approved))) / 1e6)}</span>
              <Points as="ul" layout="stack" className="mt-1.5">
                {maybe.map((l) => {
                  const ph = maybeOf(l)!;
                  return (
                    <Point
                      key={l.id}
                      as="li"
                      size="sm"
                      tone="warn"
                      title={
                        <>
                          {ph.label} <span className="num font-normal text-ink-3">· {money(Number(l.approved) / 1e6)}</span>
                        </>
                      }
                    >
                      <span className="text-ink-3">{ph.tieBreaker ? "Only if the sources disagree" : `Only if ${ph.conditional}`} · from {l.payeeName}</span>
                    </Point>
                  );
                })}
              </Points>
            </li>
          )}
          {exchange.map((l) => (
            <li key={l.id} className="flex gap-2">
              <span className="num shrink-0 text-ink-3">{always.length + 1}.</span>
              <span className="min-w-0">
                <span className="font-medium">Order at your price</span>
                <span className="block text-ink-3">{p?.venue === "paper" ? "Practice: priced live, never sent" : `On ${l.payeeName}`}</span>
              </span>
            </li>
          ))}
          {yours.map((ph, i) => (
            <li key={ph.id} className="flex gap-2" data-testid="review-yours">
              <span className="num shrink-0 text-ink-3">{always.length + exchange.length + i + 1}.</span>
              <span className="min-w-0">
                <span className="font-medium">{ph.label}</span>
                <span className="block text-ink-3">You finish it in {ph.finish!.app}: a ready link, nothing paid here</span>
              </span>
            </li>
          ))}
          {!paid.length && !exchange.length && !yours.length && <li className="text-ink-2">Free lookups only.</li>}
        </ol>
      ),
    },
    {
      kind: "risk",
      title: "Risk & safeguards",
      sub: "If something goes wrong",
      body: (
        <Points as="ul" layout="stack" data-testid="review-risks">
          {specific.map((r) => (
            <Point key={r.if} as="li" size="sm" tone="warn" title={`${r.if}:`} data-testid="review-risk">
              {r.then}
            </Point>
          ))}
          {paid.length > 0 && (
            <Point as="li" size="sm" tone="good" title="If a step fails:" data-testid="review-risk">
              it stops and asks you to try again, skip or stop. A seller that sends nothing usable is refunded. What isn&apos;t spent comes back.
            </Point>
          )}
          {!specific.length && !paid.length && (
            <Point as="li" size="sm" tone="good">
              Free: nothing is bought.
            </Point>
          )}
        </Points>
      ),
    },
  ];
  return (
    <ol className="grid gap-x-3 gap-y-4 md:grid-cols-3" aria-label="About this job">
      {cards.map((c, i) => {
        const on = focused === c.kind;
        return (
          <li key={c.kind} className="flex min-w-0 flex-col">
            {/* A numbered rail across the four, read left to right. */}
            <div className="mb-2 flex items-center gap-2" aria-hidden>
              <span className={`num inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] text-[11px] font-semibold ${on ? "bg-agent text-agent-on" : "border-[1.5px] border-[#d5d4ce] bg-panel text-ink-2"}`}>{i + 1}</span>
              <span className="whitespace-nowrap text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">{c.sub}</span>
              {i < cards.length - 1 && <span className="hidden h-px flex-1 border-t border-dashed border-[#c9c8c2] md:block" />}
            </div>
            <div className={`flex-1 rounded-2xl border bg-panel p-3.5 transition-[border-color,box-shadow] ${on ? "border-[1.5px] border-ink shadow-[3px_3px_0_0_var(--agent)]" : "border-line"}`} data-testid={`card-${c.kind}`} aria-pressed={onEdit ? on : undefined}>
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="text-[15px] font-semibold leading-tight">{c.title}</h3>
                {onEdit && (
                  <button type="button" onClick={() => onEdit(c.kind)} aria-pressed={on} aria-label={`Change ${c.title.toLowerCase()} in the chat`} className="pressable -mr-1.5 -mt-1 inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink" data-testid={`edit-${c.kind}`}>
                    <Icon name={on ? "chat" : "edit"} size={12} /> {on ? "In chat" : "Change"}
                  </button>
                )}
              </div>
              {c.body}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The cost, itemized: every paid lookup with its seller and price, the order, and the most it can
 * take in total. One section, so no number is said twice.
 */
export function ReviewTotal({ run, onEdit, focused }: { run: Run; onEdit?: () => void; focused?: boolean }) {
  const paid = run.lines.filter((l) => paidInUsdc(l.rail));
  const data = sum(paid.map((l) => l.approved));
  const order = orderCost(run);
  const most = Number(data) / 1e6 + order;
  const row = "flex items-baseline justify-between gap-3 py-1.5 text-[13.5px]";
  return (
    <section className={`rounded-2xl border bg-panel px-4 py-3 transition-[border-color,box-shadow] ${focused ? "border-[1.5px] border-ink shadow-[3px_3px_0_0_var(--agent)]" : "border-line"}`} aria-label="Cost" data-testid="review-total">
      <div className="flex items-center justify-between gap-2" data-testid="card-price">
        <h3 className="text-[15px] font-semibold">Cost</h3>
        {onEdit && (
          <button type="button" onClick={onEdit} aria-pressed={Boolean(focused)} aria-label="Change the cost in the chat" className="pressable -mr-1.5 inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink" data-testid="edit-price">
            <Icon name={focused ? "chat" : "edit"} size={12} /> {focused ? "In chat" : "Change"}
          </button>
        )}
      </div>
      <div className="mt-1 divide-y divide-[#f1f0ec]" data-testid="review-cost" data-usdc={fmt(data)}>
        {paid.map((l) => (
          <div key={l.id} className={row}>
            <span className="min-w-0 text-ink-2">
              {run.phases.find((ph) => ph.lineId === l.id)?.label ?? l.purpose} <span className="text-ink-3">· {l.payeeName}</span>
            </span>
            <span className="num shrink-0">{money(Number(l.approved) / 1e6)}</span>
          </div>
        ))}
        {order > 0 && (
          <div className={row}>
            <span className="min-w-0 text-ink-2">The order, at most{run.proposal?.venue === "paper" ? <span className="text-ink-3"> · practice</span> : null}</span>
            <span className="num shrink-0">{money(order)}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-3 pt-2.5">
          <span className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">Maximum total</span>
          <span className="num text-[20px] font-semibold" data-testid="review-most">
            {money(most)}
          </span>
        </div>
      </div>
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

  // While it works, the card is the page's main thing: ink outline, the agent's color, a progress bar.
  const working = !finished && (run.status === "running" || run.status === "funding");
  const look = working ? (needs ? "border-ink bg-warn/10 shadow-[4px_4px_0_0_var(--color-warn)]" : "border-ink bg-panel shadow-[4px_4px_0_0_var(--agent)]") : TONE[out.tone];
  return (
    <section className={`rounded-2xl border-[1.5px] ${look}`} aria-label="Status" data-testid="status-card">
      <div className="px-4 py-3.5">
        {working && (
          <p className={`mb-1.5 font-pixel text-[11px] uppercase tracking-wide ${needs ? "text-warn-ink" : "text-agent-ink"}`} data-testid="status-label">
            {needs ? "Needs you" : run.status === "funding" ? "Setting up" : "Working on it"}
          </p>
        )}
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
        {working && run.phases.length > 0 && <Progress run={run} />}
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
            <Button variant="ghost" className="h-9" onClick={onCancel}>
              <Icon name="x" size={14} /> Stop the job
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
        <div className="border-t border-[#f1f0ec] px-4 py-3">
          <Points as="ul" min={220} data-testid="findings">
            {run.deliverable.notes.slice(0, 4).map((n) => (
              <Point key={n} as="li" size="sm" tone="agent">
                {n}
              </Point>
            ))}
          </Points>
        </div>
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

const SEGMENT: Record<Phase["status"], string> = {
  done: "bg-agent",
  skipped: "bg-ink-3/30",
  active: "bg-agent/40 animate-pulse motion-reduce:animate-none",
  failed: "bg-bad",
  failed_waiting: "bg-bad animate-pulse motion-reduce:animate-none",
  awaiting_reapproval: "bg-warn animate-pulse motion-reduce:animate-none",
  planned: "bg-line",
};

/** How far the job is, at a glance: one bar part per step, and what it has spent of what was set aside. */
function Progress({ run }: { run: Run }) {
  const n = run.phases.length;
  const done = run.phases.filter((p) => p.status === "done" || p.status === "skipped").length;
  const paid = run.lines.filter((l) => l.rail !== "exchange");
  const spent = sum(paid.map((l) => l.actual));
  // The same "up to" the job map shows: what the approved steps can cost, not the vault's small buffer.
  const most = sum(paid.map((l) => l.approved));
  const practice = run.mode === "demo";
  return (
    <div className="mt-3" data-testid="status-progress">
      <ol className="flex gap-1.5" aria-label={`${done} of ${n} steps done`}>
        {run.phases.map((p, i) => (
          <li key={p.id} className={`h-2.5 flex-1 rounded-full ${SEGMENT[p.status] ?? "bg-line"}`} title={`${i + 1}. ${p.label}`} />
        ))}
      </ol>
      <div className="mt-2.5 flex flex-wrap gap-1.5 text-[12.5px]">
        <span className="rounded-lg border border-line bg-surface px-2.5 py-1">
          <span className="font-semibold">{done}</span> of {n} steps done
        </span>
        <span className="num rounded-lg border border-line bg-surface px-2.5 py-1">
          Spent <span className="font-semibold">${fmt(spent)}</span> of up to ${fmt(most)}
        </span>
        <span className="rounded-lg border border-agent/30 bg-agent-soft/60 px-2.5 py-1 text-agent-ink">{practice ? "Practice: no real money moves" : "Anything unused comes back to you"}</span>
      </div>
    </div>
  );
}
