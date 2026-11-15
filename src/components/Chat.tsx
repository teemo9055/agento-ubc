"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Card, ChatMsg, MoveAction, MoveCondition, Plan, PlanStep, Proposal, Run, Venue } from "@/lib/types";
import Link from "next/link";
import { THEMES } from "@/lib/themes";
import { fmt } from "@/lib/money";
import { AgentIcon } from "./AgentIcon";
import { Button, Spinner } from "./ui";
import { Icon } from "./Icon";
import { post } from "./useRun";
import { toast } from "./Toaster";
import { runOutfit } from "@/lib/summary";

const RESEARCH_PRICE: Record<string, number> = { odds_history: 0.02, trade_tape: 0.1, spot_candles: 0.02, drive_route: 0.03, oracle_price: 0.0001, gas_price: 0.0001, btc_network: 0.0002, wallet_balance: 0.0001 };
/** What a paid lookup costs; a marketplace service carries the price its seller quoted. */
const lookupCost = (r: Proposal["research"][number]) => (r.tool === "service" ? Number(r.args.price ?? 0) / 1e6 : (RESEARCH_PRICE[r.tool] ?? 0));
const usdc = (x: number) => (x < 0.01 ? x.toFixed(4) : x.toFixed(2));
const cents = (x: number) => `${Math.round(x * 100)}¢`;

export function actionText(a: MoveAction) {
  if (a.kind === "prediction_order" && a.trade === "sell") return `Sell ${a.quantity} × ${a.side.toUpperCase()} “${a.label}” at ≥ ${cents(a.maxPrice)}, resting until filled`;
  if (a.kind === "prediction_order")
    return a.orderType === "stop-limit"
      ? `${a.quantity} × ${a.side.toUpperCase()} “${a.label}” once it rises to ${cents(a.stopPrice ?? a.maxPrice)}, paying ≤ ${cents(a.maxPrice)}`
      : `${a.quantity} × ${a.side.toUpperCase()} “${a.label}” at ≤ ${cents(a.maxPrice)}, resting until filled`;
  if (a.kind === "spot_order") return `${a.side === "buy" ? "Buy" : "Sell"} $${a.amountUsd} of ${a.symbol.replace(/usd$/, "").toUpperCase()} at ${a.side === "buy" ? "≤" : "≥"} $${a.limitPrice.toLocaleString()}`;
  return `Plan ${a.stops.join(" → ")} · ≤ ${a.hoursPerDay} h/day`;
}
export function conditionLabel(c: MoveCondition) {
  const coin = c.symbol.replace(/usd$/, "").toUpperCase();
  const what = c.metric === "oracle_price" ? `Chainlink ${coin}` : c.metric === "spot_price" ? `${coin} price` : c.metric === "yes_price" ? "YES price" : "NO price";
  const dollars = c.metric === "spot_price" || c.metric === "oracle_price";
  return `${what} ${c.op === "<=" ? "≤" : "≥"} ${dollars ? `$${c.value.toLocaleString()}` : cents(c.value)}`;
}
const maxCost = (a?: MoveAction) => (!a ? 0 : a.kind === "prediction_order" ? (a.trade === "sell" ? 0 : a.maxPrice * a.quantity) : a.kind === "spot_order" ? a.amountUsd : 0);

const VENUE_BADGE: Record<Venue, { label: string; title: string; cls: string }> = {
  gemini: { label: "Live · real money", title: "Orders go to your Gemini account with real money", cls: "border-bad/50 bg-bad/10 text-bad" },
  "gemini-sandbox": { label: "Gemini sandbox · test money", title: "Real orders on Gemini's test exchange, with test funds", cls: "border-agent/40 bg-agent-soft text-agent-ink" },
  paper: { label: "Practice · no real order", title: "No exchange is connected, so the order is only simulated", cls: "border-warn bg-warn/15 text-warn-ink" },
};

export function VenueBadge({ venue }: { venue: Venue }) {
  const b = VENUE_BADGE[venue];
  return (
    <span className={`inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-md border px-2 text-[12px] font-semibold ${b.cls}`} title={b.title} data-testid="venue-badge">
      {b.label}
    </span>
  );
}

/** A proposed move. In chat it carries the "Build graph" button; once chosen it is the plan's summary. */
/** Short labels for paid steps, so the card reads as a sentence, not a spreadsheet. */
const STEP_LABEL: Record<string, (r: Proposal["research"][number]) => string> = {
  oracle_price: (r) => `Chainlink ${r.args.symbol?.replace(/usd$/i, "").toUpperCase()}`,
  odds_history: () => "Odds history",
  trade_tape: () => "Trade flow",
  spot_candles: (r) => `${r.args.symbol?.replace(/usd$/i, "").toUpperCase()} chart`,
  drive_route: () => "Route",
};

/** Only the notes that change the decision, said briefly. */
function notes(p: Proposal) {
  return (p.adjustments ?? [])
    .filter((x) => !/^Price rounded/.test(x))
    .map((x) =>
      x
        .replace(/^Contract closes \w+, (\d+) (\w+) \d{4} (\d\d:\d\d) UTC$/, "Closes $2 $1, $3 UTC")
        .replace(/^Fills now: cheapest (YES|NO) seller is at (\d+¢)$/, "Fills now at $2")
        .replace(/^Waits on the book: cheapest (YES|NO) seller is at (\d+¢) now$/, "Waits until the price drops (now $2)")
        .replace(/^Price check folded into the order.*$/, "Waits on the exchange until the price is right"),
    );
}

export function MoveCard({ p, run, chosen, onChoose, busy }: { p: Proposal; run: Run; chosen?: boolean; onChoose?: () => void; busy?: boolean }) {
  const research = p.research.reduce((s, r) => s + lookupCost(r), 0);
  const total = research + maxCost(p.action);
  const trade = p.action && p.action.kind !== "itinerary";
  // One line of facts: the most it costs, then the one or two notes that change the decision.
  const facts = [
    `Up to $${total < 0.01 ? usdc(total) : total.toFixed(2)}`,
    p.research.length ? `${p.research.length} paid lookup${p.research.length > 1 ? "s" : ""} first` : "",
    p.condition ? `only if ${[p.condition, ...(p.also ?? [])].map(conditionLabel).join(" and ")}` : "",
    ...notes(p)
      .filter((x) => !/^Sized to|^Hedge|^Fee/.test(x))
      .slice(0, 2),
  ].filter(Boolean);
  return (
    <div className={`mt-2 rounded-xl border-[1.5px] bg-panel p-3.5 ${chosen ? "border-line" : "border-ink shadow-[3px_3px_0_0_var(--agent)]"}`} data-testid="move-card">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[15px] font-semibold leading-snug">{p.title}</div>
        {chosen ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-good">
            <Icon name="check" size={13} stroke={2.6} /> Chosen
          </span>
        ) : (
          trade && p.venue !== "paper" && <VenueBadge venue={p.venue ?? "paper"} />
        )}
      </div>
      <p className="mt-1 text-[13.5px] leading-snug text-ink-2">{p.ask}</p>
      {p.changes && p.changes.length > 0 && (
        <p className="mt-2 text-[12px] font-medium text-agent-ink" data-testid="move-changes">
          Changed: {p.changes.join(" · ")}
        </p>
      )}
      <p className="num mt-2 text-[12.5px] text-ink-3" data-testid="move-facts">
        {facts.join(" · ")}
        {p.venue === "paper" && trade ? " · practice order" : ""}
      </p>
      {onChoose && !chosen && (
        <Button onClick={onChoose} disabled={busy || run.status !== "exploring"} variant="agent" className="mt-3 h-10 w-full" data-testid="adopt-move">
          {busy ? <Spinner /> : null} Review and approve <Icon name="arrow" size={15} stroke={2.2} />
        </Button>
      )}
    </div>
  );
}

const STEP_STATUS: Record<PlanStep["status"], { text: string; cls: string }> = {
  waiting: { text: "Next", cls: "text-ink-3" },
  running: { text: "Running", cls: "text-agent-ink" },
  blocked: { text: "Waiting", cls: "text-warn-ink" },
  done: { text: "Done", cls: "text-good" },
  failed: { text: "Didn't go through", cls: "text-bad" },
  skipped: { text: "Skipped", cls: "text-ink-3" },
};

const stepCost = (p: Proposal) => p.research.reduce((s, r) => s + lookupCost(r), 0) + maxCost(p.action);

/** Several moves in a row, possibly by different agents. Started once; each step runs as its own job. */
export function PlanCard({ plan, run }: { plan: Plan; run: Run }) {
  const [busy, setBusy] = useState(false);
  const live = run.plan?.id === plan.id ? run.plan : plan;
  const total = live.steps.reduce((s, st) => s + stepCost(st.proposal), 0);
  const startedElsewhere = run.plan && run.plan.id !== plan.id && run.plan.status === "running";
  async function act(path: "plan-start" | "plan-stop") {
    setBusy(true);
    try {
      await post(`/api/runs/${run.id}/${path}`, path === "plan-start" ? { planId: plan.id } : {});
      toast(path === "plan-start" ? "Plan started · each step runs as its own job" : "Plan stopped", "good");
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`mt-2 rounded-xl border-[1.5px] bg-panel p-3.5 ${live.status === "proposed" ? "border-ink shadow-[3px_3px_0_0_var(--agent)]" : "border-line"}`} data-testid="plan-card">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[15px] font-semibold leading-snug">{live.title}</div>
        {live.status !== "proposed" && (
          <span className={`shrink-0 text-[12px] font-semibold ${live.status === "done" ? "text-good" : live.status === "stopped" ? "text-ink-3" : "text-agent-ink"}`} data-testid="plan-status">
            {live.status === "running" ? "Running" : live.status === "done" ? "Finished" : "Stopped"}
          </span>
        )}
      </div>
      <p className="mt-1 text-[13.5px] leading-snug text-ink-2">{live.why}</p>
      <ol className="mt-2.5 space-y-2" aria-label="Plan steps">
        {live.steps.map((st, i) => {
          const s = STEP_STATUS[st.status];
          const cost = stepCost(st.proposal);
          return (
            <li key={st.id} className="flex gap-2.5 rounded-lg border border-line p-2.5" data-testid="plan-step">
              <span className="mt-0.5 shrink-0">
                <AgentIcon agent={st.agent} size={26} mood={st.status === "running" ? "working" : "happy"} />
              </span>
              <div className="min-w-0 flex-1 text-[13px]">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="font-medium">
                    {i + 1}. {st.proposal.title}
                  </span>
                  {live.status !== "proposed" && (
                    <span className={`text-[12px] font-semibold ${s.cls}`} data-testid="plan-step-status">
                      {s.text}
                    </span>
                  )}
                </div>
                <div className="text-[12px] text-ink-3">
                  {THEMES[st.agent].name}
                  {st.proposal.action ? ` · ${actionText(st.proposal.action)}` : ""}
                  {st.proposal.research.length ? ` · ${st.proposal.research.length} lookup${st.proposal.research.length > 1 ? "s" : ""}` : ""}
                  {cost > 0 ? ` · ≤ $${cost < 0.01 ? usdc(cost) : cost.toFixed(2)}` : ""}
                </div>
                {(st.status === "waiting" || st.status === "blocked") && live.steps.length > 1 && (
                  <div className="text-[12px] text-ink-3" data-testid="plan-step-when">
                    {(st.after ?? []).length === 0
                      ? live.steps.filter((x) => !(x.after ?? []).length).length > 1
                        ? "Starts right away, alongside the others"
                        : "Starts right away"
                      : `After step ${(st.after ?? []).map((id) => id.replace(/^s/, "")).join(" and ")}${st.gate === "filled" ? "’s order fills" : ""}${st.useProceeds ? " · spends what it brings in" : ""}`}
                  </div>
                )}
                {(st.note || st.runId) && live.status !== "proposed" && (
                  <div className="mt-0.5 text-[12px] text-ink-2">
                    {st.note}
                    {st.runId && (
                      <>
                        {st.note ? " · " : ""}
                        <Link href={`/runs/${st.runId}`} className="underline decoration-line underline-offset-2" data-testid="plan-step-link">
                          Open
                        </Link>
                      </>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {live.unavailable.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[12px]" data-testid="plan-unavailable">
          {live.unavailable.map((u) => (
            <li key={u.what} className="text-ink-2">
              <span className="font-medium text-bad">Can&apos;t do here:</span> {u.what}. <span className="text-ink-3">{u.why}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#f1f0ec] pt-2.5">
        <span className="num text-[12.5px] text-ink-2">≤ ${total < 0.01 ? usdc(total) : total.toFixed(2)} across {live.steps.length} steps</span>
        {live.status === "proposed" && !startedElsewhere && (
          <Button onClick={() => act("plan-start")} disabled={busy || run.status !== "exploring"} variant="agent" className="h-9" data-testid="start-plan">
            {busy ? <Spinner /> : null} Start plan
          </Button>
        )}
        {live.status === "running" && (
          <Button onClick={() => act("plan-stop")} disabled={busy} variant="danger" className="h-9" data-testid="stop-plan">
            {busy ? <Spinner /> : null} Stop
          </Button>
        )}
      </div>
    </div>
  );
}

/** The model sometimes uses **bold**; render it rather than show asterisks. */
function Rich({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (/^\*\*[^*]+\*\*$/.test(part) ? <b key={i} className="font-semibold">{part.slice(2, -2)}</b> : part))}</>;
}

function AgentRow({ run, mood = "happy", children }: { run: Run; mood?: "happy" | "working"; children: React.ReactNode }) {
  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2.5">
      <span className="mt-0.5 shrink-0">
        <AgentIcon agent={run.agent} size={28} outfit={runOutfit(run)} mood={mood} />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </motion.li>
  );
}

function UserRow({ children, tag }: { children: React.ReactNode; tag?: string }) {
  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end" data-testid="msg-user">
      <div className="max-w-[85%]">
        {tag && <div className="mb-1 text-right text-[11px] font-semibold uppercase tracking-wide text-agent-ink">{tag}</div>}
        <div className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink px-3.5 py-2.5 text-[14px] leading-relaxed text-white">{children}</div>
      </div>
    </motion.li>
  );
}

const bubble = "whitespace-pre-wrap rounded-2xl rounded-bl-md border border-line bg-panel px-3.5 py-2.5 text-[14px] leading-relaxed";

function Bubble({ m, run, onChoose, busy }: { m: ChatMsg; run: Run; onChoose: (id: string) => void; busy: boolean }) {
  if (m.role === "user") return <UserRow>{m.text}</UserRow>;
  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2.5" data-testid="msg-agent">
      <span className="mt-0.5 shrink-0">
        <AgentIcon agent={run.agent} size={28} outfit={runOutfit(run)} mood="happy" />
      </span>
      <div className="min-w-0 flex-1">
        {m.tools && m.tools.length > 0 && (
          <details className="group mb-1 text-[11.5px] text-ink-3" data-testid="lookups">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 hover:text-ink-2">
              <Icon name="search" size={11} /> Checked {m.tools.length} {m.tools.length === 1 ? "source" : "sources"}
              <Icon name="chevron" size={10} className="transition-transform group-open:rotate-90" />
            </summary>
            <ul className="mt-1 space-y-0.5 pl-4">
              {m.tools.map((t, i) => (
                <li key={i} className={t.ok ? "" : "text-warn-ink"}>
                  {t.summary}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className={bubble}>
          <Rich text={m.text} />
        </div>
        {m.unverified && m.unverified.length > 0 && (
          <p className="mt-1 text-[11.5px] text-warn-ink" data-testid="unverified">
            Couldn't check {m.unverified.join(", ")} against live data; treat as approximate.
          </p>
        )}
        {m.plan && <PlanCard plan={m.plan} run={run} />}
        {m.proposal && <MoveCard p={m.proposal} run={run} chosen={run.proposal?.id === m.proposal.id} onChoose={() => onChoose(m.proposal!.id)} busy={busy} />}
      </div>
    </motion.li>
  );
}

export const CARD_LABEL: Record<Card["kind"], string> = { price: "Price", deliverable: "Deliverable", method: "Method", risk: "Risk" };
const CARD_HINT: Record<Card["kind"], string> = {
  price: "e.g. big-spend threshold 0.5",
  deliverable: "e.g. make it 5 contracts",
  method: "e.g. add a Chainlink check",
  risk: "e.g. no condition, or max 50¢",
};

/** What the chat is editing: a card of the plan, or one step of the graph. */
export type EditTarget = { kind: "card"; card: Card["kind"] } | { kind: "step"; step: string; label: string; hint: string };

/** The edit target for a graph step, with a hint matched to what that step can change; null for steps with nothing to edit. */
export function stepTarget(run: Run, phaseId: string): EditTarget | null {
  const ph = run.phases.find((p) => p.id === phaseId);
  const p = run.proposal;
  if (!ph || !p) return null;
  const r = p.research.find((x) => x.id === phaseId);
  let hint = "";
  if (r) hint = r.tool === "drive_route" ? "e.g. add Kamloops" : r.tool === "odds_history" ? "e.g. use hourly data, or drop it" : r.tool === "spot_candles" ? "e.g. use daily data, or drop it" : "e.g. drop this step";
  else if (phaseId === "check") {
    if (!p.condition) return null;
    hint = p.condition.metric === "spot_price" ? `e.g. only if below $${Math.round(p.condition.value * 0.98).toLocaleString("en-US")}, or drop the check` : "e.g. only if below 40¢, or drop the check";
  } else if (phaseId === "act") hint = p.action?.kind === "itinerary" ? "e.g. 4 hours a day" : p.action?.kind === "spot_order" ? "e.g. $5, or don't place the trade" : "e.g. 8 contracts, max 50¢";
  else return null;
  return { kind: "step", step: phaseId, label: ph.label, hint };
}

export const targetKey = (t?: EditTarget | null) => (!t ? "" : t.kind === "card" ? `card:${t.card}` : `step:${t.step}`);
const targetName = (t: EditTarget) => (t.kind === "card" ? CARD_LABEL[t.card] : t.label);
const targetBody = (t: EditTarget) => (t.kind === "card" ? { card: t.card } : { step: t.step });

interface Preview {
  ok: boolean;
  message: string;
  alternatives?: string[];
  before?: { total: string; lines: { purpose: string; approved: string }[] };
  after?: { total: string; lines: { purpose: string; approved: string }[] };
}

/** A card edit asked in chat: the request, then a priced preview to apply or drop. Lives only in this browser tab. */
interface EditTurn {
  id: number;
  target: EditTarget;
  prompt: string;
  state: "checking" | "preview" | "applying" | "applied" | "dropped";
  preview?: Preview;
}

function EditReply({ t, run, onApply, onDrop, onTry, last }: { t: EditTurn; run: Run; onApply: () => void; onDrop: () => void; onTry: (alt: string) => void; last: boolean }) {
  if (t.state === "checking")
    return (
      <AgentRow run={run} mood="working">
        <div className={`${bubble} inline-flex items-center gap-2 text-ink-2`}>
          <Spinner /> {run.planner === "ai" ? "Thinking it through and re-pricing…" : "Re-pricing…"}
        </div>
      </AgentRow>
    );
  const p = t.preview!;
  if (!p.ok)
    return (
      <AgentRow run={run}>
        <div className="rounded-2xl rounded-bl-md border border-bad/30 bg-bad/5 px-3.5 py-2.5 text-[14px]" role="alert">
          <div className="font-semibold text-bad">Can&apos;t do that</div>
          <div className="mt-0.5 text-ink-2">{p.message}</div>
        </div>
        {last && p.alternatives && p.alternatives.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.alternatives.map((a) => (
              <button key={a} type="button" onClick={() => onTry(a)} className="pressable rounded-lg border border-agent/40 bg-agent-soft px-3 py-1.5 text-[13px] font-medium text-agent-ink hover:border-agent">
                {a}
              </button>
            ))}
          </div>
        )}
      </AgentRow>
    );
  const delta = p.before && p.after ? BigInt(p.after.total) - BigInt(p.before.total) : 0n;
  const settled = t.state === "applied" || t.state === "dropped" || run.status !== "draft";
  return (
    <AgentRow run={run}>
      <div className={`rounded-2xl rounded-bl-md border-[1.5px] bg-panel p-3.5 text-[13.5px] ${settled ? "border-line" : "border-ink shadow-[3px_3px_0_0_var(--agent)]"}`} data-testid={settled ? undefined : "edit-preview"}>
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold">{p.message}</span>
          {p.before && p.after && (
            <span className="num shrink-0">
              {fmt(p.before.total)} → <b>{fmt(p.after.total)}</b>
              {delta !== 0n && <span className={`ml-1.5 text-[12px] ${delta < 0n ? "text-good" : "text-ink-3"}`}>{delta < 0n ? `−${fmt(-delta)}` : `+${fmt(delta)}`}</span>}
            </span>
          )}
        </div>
        {p.after && (
          <ul className="mt-2 space-y-0.5 text-[12.5px] text-ink-2">
            {p.after.lines.map((l) => (
              <li key={l.purpose} className="flex justify-between gap-3">
                <span>{l.purpose}</span>
                <span className="num">{fmt(l.approved)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-center justify-end gap-2 border-t border-[#f1f0ec] pt-2.5">
          {t.state === "applied" ? (
            <motion.span
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 520, damping: 18 }}
              className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-good"
            >
              <Icon name="check" size={13} stroke={2.6} /> Applied to the plan
            </motion.span>
          ) : settled ? (
            <span className="text-[12.5px] text-ink-3">Not applied</span>
          ) : (
            <>
              <Button variant="quiet" className="h-9" onClick={onDrop} disabled={t.state === "applying"}>
                Not now
              </Button>
              <Button variant="agent" className="h-9" onClick={onApply} disabled={t.state === "applying" || run.status !== "draft"} data-testid="apply-edit">
                {t.state === "applying" ? <Spinner /> : null} Apply change
              </Button>
            </>
          )}
        </div>
      </div>
    </AgentRow>
  );
}

/**
 * The conversation with the agent, docked beside the plan for the whole job.
 * With a card in focus, messages edit that card: the agent re-prices and you apply or drop the change.
 */
export function Chat({ run, focus, onFocusClear, onAdopted }: { run: Run; focus?: EditTarget | null; onFocusClear?: () => void; onAdopted?: () => void }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [edits, setEdits] = useState<EditTurn[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const chat = run.chat ?? [];
  const last = chat[chat.length - 1];
  const open = run.status === "exploring" || run.status === "draft";
  const editing = Boolean(focus) && run.status === "draft";
  const busy = Boolean(run.thinking) || sending || edits.some((e) => e.state === "checking" || e.state === "applying");

  // New messages scroll into view inside the panel, not the page.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [chat.length, run.thinking, edits]);

  useEffect(() => {
    if (focus) input.current?.focus();
  }, [focus]);

  const patch = (id: number, p: Partial<EditTurn>) => setEdits((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  async function checkEdit(target: EditTarget, prompt: string) {
    const id = Date.now();
    setEdits((xs) => [...xs.map((x) => (x.state === "preview" ? { ...x, state: "dropped" as const } : x)), { id, target, prompt, state: "checking" }]);
    try {
      const preview = await post<Preview>(`/api/runs/${run.id}/preview`, { ...targetBody(target), prompt });
      patch(id, { state: "preview", preview });
    } catch (e) {
      patch(id, { state: "preview", preview: { ok: false, message: (e as Error).message } });
    }
  }

  async function applyEdit(t: EditTurn) {
    patch(t.id, { state: "applying" });
    try {
      await post<Run>(`/api/runs/${run.id}/edit`, { ...targetBody(t.target), prompt: t.prompt });
      patch(t.id, { state: "applied" });
      toast(t.preview?.message ?? "Plan updated", "good");
      onFocusClear?.();
    } catch (e) {
      patch(t.id, { state: "preview" });
      toast((e as Error).message, "bad");
    }
  }

  async function send(t: string) {
    const msg = t.trim();
    if (!msg || busy) return;
    setText("");
    if (editing && focus) return checkEdit(focus, msg);
    setSending(true);
    try {
      if (run.status === "draft") await post(`/api/runs/${run.id}/back`);
      await post(`/api/runs/${run.id}/chat`, { text: msg });
    } catch (e) {
      toast((e as Error).message, "bad");
      setText(msg);
    } finally {
      setSending(false);
    }
  }

  async function choose(proposalId: string) {
    setAdopting(true);
    try {
      await post(`/api/runs/${run.id}/adopt`, { proposalId });
      setEdits([]);
      toast("Ready to review · nothing is spent until you approve", "good");
      onAdopted?.();
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setAdopting(false);
    }
  }

  const accept = (s: string) => /^(yes|set it up|build|do it|ok|start)/i.test(s);
  const placeholder = editing && focus ? (focus.kind === "card" ? CARD_HINT[focus.card] : focus.hint) : run.status === "draft" ? "Ask for something different" : last?.options?.length ? "Or type your own answer" : chat.length > 1 ? "Reply or ask something else" : `Ask ${THEMES[run.agent].name} anything`;

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Chat with the agent">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <ul className="space-y-4" aria-live="polite">
          {chat.map((m) => (
            <Bubble key={m.id} m={m} run={run} onChoose={choose} busy={adopting} />
          ))}
          <AnimatePresence>
            {run.thinking && (
              <motion.li initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2.5 text-[13px] text-ink-3" data-testid="thinking">
                <AgentIcon agent={run.agent} size={28} outfit={runOutfit(run)} mood="working" />
                <span className="inline-flex items-center gap-1.5 rounded-2xl border border-line bg-panel px-3 py-2">
                  <Spinner /> {run.thinking}…
                </span>
              </motion.li>
            )}
          </AnimatePresence>
          {edits.map((t, i) => (
            <li key={t.id} className="space-y-4">
              <ul className="space-y-4">
                <UserRow tag={`Editing ${targetName(t.target)}`}>{t.prompt}</UserRow>
                <EditReply
                  t={t}
                  run={run}
                  last={i === edits.length - 1}
                  onApply={() => applyEdit(t)}
                  onDrop={() => patch(t.id, { state: "dropped" })}
                  onTry={(alt) => checkEdit(t.target, alt)}
                />
              </ul>
            </li>
          ))}
        </ul>
      </div>

      {open ? (
        <div className="border-t border-line bg-panel px-3 pb-3 pt-2.5">
          {!busy && run.status === "exploring" && last?.role === "agent" && last.options && last.options.length > 0 && (
            <div className="mb-2.5 grid gap-1.5 sm:grid-cols-2" data-testid="answer-options">
              {last.options.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="pressable rounded-lg border-[1.5px] border-ink bg-panel px-3 py-2.5 text-left text-[14px] font-medium hover:bg-agent-soft">
                  {s}
                </button>
              ))}
            </div>
          )}
          {!busy && run.status === "exploring" && last?.role === "agent" && !last.options?.length && !last.proposal && !last.plan && last.suggestions && last.suggestions.length > 0 && (
            <div className="mb-2.5 flex flex-wrap gap-1.5" data-testid="next-steps">
              {last.suggestions
                .filter((s) => !accept(s))
                .slice(0, 3)
                .map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className={`pressable rounded-lg border px-3 py-1.5 text-[13px] font-medium ${i === 0 ? "border-ink bg-ink text-white" : "border-line bg-panel text-ink-2 hover:border-ink/40"}`}
                  >
                    {s}
                  </button>
                ))}
            </div>
          )}
          {/* With a card on screen its button is the next step; the chips are only ways to change it. */}
          {!busy && run.status === "exploring" && last?.role === "agent" && (last.proposal || last.plan) && last.suggestions && last.suggestions.filter((s) => !accept(s)).length > 0 && (
            <div className="mb-2.5 flex flex-wrap items-center gap-1.5" data-testid="tweaks">
              <span className="text-[12px] text-ink-3">Or change it:</span>
              {last.suggestions
                .filter((s) => !accept(s) && !/^not now$/i.test(s))
                .slice(0, 2)
                .map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} className="pressable rounded-lg border border-line bg-panel px-2.5 py-1 text-[12.5px] text-ink-2 hover:border-ink/40">
                    {s}
                  </button>
                ))}
            </div>
          )}
          <AnimatePresence initial={false}>
            {editing && focus && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ type: "spring", stiffness: 500, damping: 32 }} className="mb-2 flex">
                <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border-[1.5px] border-ink bg-agent-soft pl-2.5 pr-1 text-[13px] font-semibold text-agent-ink" data-testid="chat-focus">
                  <Icon name="edit" size={13} /> Editing {focus.kind === "step" ? "step: " : ""}
                  {targetName(focus)}
                  <button type="button" onClick={onFocusClear} aria-label="Stop editing this card" className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-2 hover:bg-panel hover:text-ink">
                    <Icon name="x" size={13} stroke={2.2} />
                  </button>
                </span>
              </motion.div>
            )}
          </AnimatePresence>
          <form
            className={`flex items-end gap-2 rounded-xl border bg-panel p-1.5 transition-[border-color,box-shadow] ${editing ? "border-ink shadow-[3px_3px_0_0_var(--agent)]" : "border-line focus-within:border-ink/40"}`}
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
          >
            <textarea
              ref={input}
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(text);
                }
                if (e.key === "Escape" && editing) onFocusClear?.();
              }}
              placeholder={placeholder}
              className="max-h-32 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-[14px] leading-snug outline-none placeholder:text-ink-3"
              maxLength={600}
              aria-label={editing && focus ? `Change ${targetName(focus)}` : "Message"}
              data-testid="chat-input"
            />
            <button
              type="submit"
              disabled={busy || !text.trim()}
              aria-label={editing ? "Preview change" : "Send"}
              className="pix-press inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-[1.5px] border-ink bg-agent text-agent-on disabled:opacity-40 disabled:shadow-none"
            >
              {busy ? <Spinner /> : <Icon name="send" size={17} stroke={2.2} />}
            </button>
          </form>
          {editing && <p className="mt-2 px-1 text-[12px] text-ink-3">You&apos;ll see the new price before anything changes.</p>}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-[12.5px] text-ink-3">
          <span>This job is approved, so its chat is closed.</span>
          <Link href={`/new?agent=${run.agent}`} className="font-medium text-ink underline decoration-line underline-offset-2" data-testid="ask-more">
            Ask {THEMES[run.agent].name} something else
          </Link>
        </div>
      )}
    </section>
  );
}
