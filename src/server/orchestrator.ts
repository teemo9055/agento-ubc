import { keccak256, toBytes, type Hex } from "viem";
import { randomUUID } from "node:crypto";
import type { RunEvent, SeqEvent } from "@/lib/events";
import { fmt, fmtFee, sum } from "@/lib/money";
import { checkSpend } from "@/lib/policy";
import { reduce, reduceAll } from "@/lib/reducer";
import { appendEvent, loadAll } from "./store";
import type {
  AgentId,
  Card,
  CostLine,
  Decision,
  Failure,
  FailureAction,
  Method,
  FailureCode,
  Payment,
  Phase,
  ReapprovalRequest,
  Run,
} from "@/lib/types";
import { AGENTS } from "./agents";
import { aiEdit, aiPlan, aiSummary } from "./agents/ai-planning";
import { aiEnabled, type AiUsage } from "./ai";
import { PhaseFailure, type AgentCtx, type PlanDraft } from "./agents/types";
import { addresses, liveReady } from "./chain";
import { adapterFor, PaymentError } from "./payments";
import { SELLERS } from "./sellers";
import { PRODUCTS } from "./x402";

const DEFAULT_THRESHOLD = 250_000n; // 0.25 USDC
const BUFFER_PCT = 20n;
const REAPPROVAL_TIMEOUT_MS = Number(process.env.REAPPROVAL_TIMEOUT_MS ?? 120_000);
const FAULT_TIMEOUT_MS = Number(process.env.FAULT_TIMEOUT_MS ?? 8_000);
/** Measured on Arc testnet: one vault authorize/pay call. 18-decimal native USDC. */
const EST_FEE_PER_TX = 2_600_000_000_000_000n;
const PAYMENT_FAULTS: FailureCode[] = ["seller_402_timeout", "payment_rejected", "settle_fails", "insufficient_balance", "price_increase", "approval_timeout"];

type Waiter = (v: string) => void;

interface Ctl {
  run: Run;
  events: SeqEvent[];
  listeners: Set<(e: SeqEvent) => void>;
  waiters: Map<string, Waiter>;
  options: Record<string, unknown>;
  memory: Record<string, unknown>;
  cache: Map<string, unknown>;
  usedFaults: Set<FailureCode>;
  seller: Record<string, "primary" | "mirror">;
  overrides: Map<string, bigint>;
  previews: Map<string, { ok: boolean; message: string; options?: Record<string, unknown>; alternatives?: string[] }>;
  funded: bigint;
  cancelled: boolean;
}

const g = globalThis as unknown as { __agentoRuns?: Map<string, Ctl> };
const runs: Map<string, Ctl> = (g.__agentoRuns ??= new Map<string, Ctl>());

const now = () => new Date().toISOString();
const id = () => randomUUID().slice(0, 8);

class Cancelled extends Error {}

// ---------- events ----------

function emit(ctl: Ctl, e: RunEvent) {
  const se = { ...e, seq: ctl.events.length } as SeqEvent;
  ctl.events.push(se);
  ctl.run = reduce(ctl.run, se)!;
  try {
    appendEvent(ctl.run.id, se, { options: ctl.options, funded: ctl.funded.toString(), seller: ctl.seller }, ctl.run.createdAt);
  } catch (err) {
    console.warn("persist failed", (err as Error).message);
  }
  for (const l of ctl.listeners) l(se);
}

function log(ctl: Ctl, d: Omit<Decision, "id" | "at">) {
  emit(ctl, { type: "decision.logged", decision: { ...d, id: id(), at: now() } });
}

export function subscribe(runId: string, fn: (e: SeqEvent) => void, from = 0) {
  const ctl = runs.get(runId);
  if (!ctl) return null;
  for (const e of ctl.events.slice(from)) fn(e);
  ctl.listeners.add(fn);
  return () => ctl.listeners.delete(fn);
}

export const getRun = (runId: string) => runs.get(runId)?.run ?? null;
export const listRuns = () => [...runs.values()].map((c) => c.run).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

// ---------- planning ----------

export function planHash(run: Pick<Run, "id" | "task" | "threshold" | "lines" | "agent">): Hex {
  const canonical = JSON.stringify({
    workOrder: run.id,
    agent: run.agent,
    task: run.task,
    threshold: run.threshold,
    lines: run.lines.map((l) => [l.id, l.index, l.payee.toLowerCase(), l.approved, l.rail]),
  });
  return keccak256(toBytes(canonical));
}

function priceCard(lines: CostLine[], cap: bigint, threshold: bigint, fees: bigint): Card {
  const total = sum(lines.map((l) => l.approved));
  const big = lines.filter((l) => l.bigSpend).length;
  const calls = lines.reduce((a, l) => a + (l.calls?.max ?? 0), 0);
  const f = (v: bigint) => fmt(v);
  return {
    kind: "price",
    title: `${f(total)} USDC`,
    points: [`Cap ${f(cap)} USDC (+${BUFFER_PCT}% buffer)`, `${calls} paid requests · ~${fmtFee(fees)} fees`, big ? `${big} big ${big === 1 ? "spend" : "spends"} over ${f(threshold)}` : `No spend over ${f(threshold)}`],
  };
}

const markup = (v: string, from: bigint, to: bigint) => ((BigInt(v) * to) / from).toString();

/** Applies the chosen method (seller, analysis) to an agent's draft plan. */
function applyMethod(ctl: Ctl, draft: PlanDraft): PlanDraft {
  const m = ctl.run.method;
  const agent = AGENTS[ctl.run.agent];
  let { lines, phases, cards } = draft;
  if (m.seller === "mirror") {
    const P = SELLERS.primary;
    const M = SELLERS.mirror;
    lines = lines.map((l) =>
      l.rail === "x402" && l.payee === P.address
        ? {
            ...l,
            payee: M.address,
            payeeName: M.name,
            approved: markup(l.approved, P.markup, M.markup),
            calls: l.calls && { ...l.calls, unitPrice: markup(l.calls.unitPrice, P.markup, M.markup) },
          }
        : l,
    );
    phases = phases.map((p) => {
      const line = lines.find((l) => l.id === p.lineId);
      return line && line.rail === "x402"
        ? { ...p, alternatives: [{ payeeName: P.name, payee: P.address, service: line.service, price: markup(line.approved, M.markup, P.markup) }] }
        : p;
    });
  }
  if (m.analysis === "ide") {
    const ph = agent.analysisPhase;
    lines = [
      ...lines,
      {
        id: "ide",
        phaseId: ph,
        purpose: "Analysis in your AI IDE",
        service: "context pack",
        payeeName: "Your subscription",
        payee: ctl.run.client,
        rail: "subscription",
        approved: "0",
      },
    ];
    phases = phases.map((p) => (p.id === ph ? { ...p, sub: "context pack for your AI IDE", lineId: "ide" } : p));
    cards = cards.map((c) => (c.kind === "method" ? { ...c, points: c.points.map((x) => (/^Built-in/.test(x) ? "Your AI IDE does the analysis" : x)) } : c));
  }
  const copy = ctl.options.cards as { deliverableTitle: string; deliverablePoints: string[]; riskPoints: string[] } | undefined;
  if (copy)
    cards = cards.map((c) =>
      c.kind === "deliverable" ? { ...c, title: copy.deliverableTitle, points: copy.deliverablePoints } : c.kind === "risk" ? { ...c, points: copy.riskPoints } : c,
    );
  cards = cards.map((c) => (c.kind === "method" ? { ...c, points: c.points.map((x) => (/^x402/.test(x) ? `x402 on Arc via ${m.seller === "mirror" ? SELLERS.mirror.name : SELLERS.primary.name}` : x)) } : c));
  return { cards, lines, phases };
}

function materialize(ctl: Ctl, raw: PlanDraft) {
  const draft = applyMethod(ctl, raw);
  const threshold = BigInt(ctl.run.threshold);
  let idx = 0;
  const lines: CostLine[] = draft.lines.map((l) => ({
    ...l,
    index: l.rail === "subscription" ? -1 : idx++,
    actual: "0",
    bigSpend: BigInt(l.approved) >= threshold,
  }));
  const total = sum(lines.map((l) => l.approved));
  const cap = total + (total * BUFFER_PCT) / 100n;
  const txs = lines.reduce((a, l) => a + (l.rail === "x402" ? (l.calls?.max ?? 1) : 0), 0) + 3; // + approve, open, close
  const fees = EST_FEE_PER_TX * BigInt(txs);
  const phases: Phase[] = draft.phases.map((p) => ({ ...p, status: "planned", payments: [] }));
  return { cards: [...draft.cards, priceCard(lines, cap, threshold, fees)], lines, phases, cap: cap.toString(), estFees: fees.toString() };
}

export async function createRun(input: { agent: AgentId; task: string; mode?: "demo" | "live"; faults?: FailureCode[] }) {
  const agent = AGENTS[input.agent];
  if (!agent) throw new Error("unknown agent");
  const mode = input.mode === "live" && liveReady() ? "live" : "demo";
  const run: Run = {
    id: id(),
    agent: input.agent,
    task: input.task.trim().slice(0, 280),
    mode,
    faults: input.faults ?? [],
    status: "draft",
    cards: [],
    lines: [],
    phases: [],
    decisions: [],
    threshold: DEFAULT_THRESHOLD.toString(),
    cap: "0",
    client: addresses.client ?? "0x0000000000000000000000000000000000000000",
    agentWallet: addresses.agent ?? "0x0000000000000000000000000000000000000000",
    pendingReapprovals: [],
    pendingFailures: [],
    createdAt: now(),
    method: { seller: "primary", analysis: "builtin" },
    planner: "rules",
    estFees: "0",
  };
  const ctl: Ctl = {
    run,
    events: [],
    listeners: new Set(),
    waiters: new Map(),
    options: { ...agent.defaults },
    memory: {},
    cache: new Map(),
    usedFaults: new Set(),
    seller: {},
    overrides: new Map(),
    previews: new Map(),
    funded: 0n,
    cancelled: false,
  };
  runs.set(run.id, ctl);
  // The model drafts options from the task; code validates, prices and can always fall back to rules.
  const drafted = aiEnabled() ? await aiPlan(run.agent, run.task) : null;
  if (drafted) {
    ctl.options = { ...ctl.options, ...drafted.options };
    run.planner = "ai";
  }
  const plan = materialize(ctl, await agent.plan(run.task, ctl.options));
  emit(ctl, { type: "workorder.updated", run: { ...run, ...plan } });
  if (drafted) trackAi(ctl, "plan", drafted.usage);
  return ctl.run;
}

const ctlOf = (runId: string) => {
  const ctl = runs.get(runId);
  if (!ctl) throw new Error("run not found");
  return ctl;
};

export async function editCard(runId: string, card: Card["kind"], prompt: string) {
  const ctl = ctlOf(runId);
  if (ctl.run.status !== "draft") throw new Error("work order already approved");
  const agent = AGENTS[ctl.run.agent];

  if (card === "price") {
    const m = prompt.match(/(\d+(?:\.\d+)?)/);
    if (/threshold|big spend/i.test(prompt) && m) {
      ctl.run.threshold = BigInt(Math.round(Number(m[1]) * 1e6)).toString();
      const plan = materialize(ctl, await agent.plan(ctl.run.task, ctl.options));
      emit(ctl, { type: "workorder.updated", run: { ...ctl.run, ...plan, editNote: { ok: true, message: `Big-spend threshold set to ${m[1]} USDC` } } });
      return ctl.run;
    }
  }

  const res = ctl.previews.get(`${card}:${prompt}`) ?? (await editOptions(ctl, card, prompt));
  ctl.previews.clear();
  if (res.ok && res.options) {
    const before = ctl.run.cards.find((c) => c.kind === "price")?.title;
    ctl.options = res.options;
    const plan = materialize(ctl, await agent.plan(ctl.run.task, ctl.options));
    const after = plan.cards.find((c) => c.kind === "price")?.title;
    emit(ctl, {
      type: "workorder.updated",
      run: { ...ctl.run, ...plan, editNote: { ok: true, message: before === after ? res.message : `${res.message} · ${before} → ${after}` } },
    });
  } else {
    emit(ctl, { type: "workorder.updated", run: { ...ctl.run, editNote: { ok: false, message: res.message, alternatives: res.alternatives } } });
  }
  log(ctl, { kind: "card_edit", what: `${card}: ${prompt}`, why: res.message, outcome: res.ok ? "edited" : "rejected", by: "user" });
  return ctl.run;
}

function trackAi(ctl: Ctl, purpose: string, usage: AiUsage) {
  emit(ctl, { type: "ai.used", purpose, usage });
}

/** AI edit first (keeps the model's card copy in sync), rule-based edit as fallback. */
async function editOptions(ctl: Ctl, card: Card["kind"], prompt: string) {
  if (aiEnabled() && ctl.run.planner === "ai") {
    const r = await aiEdit(ctl.run.agent, ctl.run.task, card, prompt, ctl.options);
    if (r) {
      trackAi(ctl, "edit", r.usage);
      return { ok: r.ok, message: r.message, alternatives: r.alternatives, options: r.ok ? { ...ctl.options, ...r.options } : undefined };
    }
  }
  return AGENTS[ctl.run.agent].edit(card, prompt, ctl.options);
}

/** Large arrays (price series) become a short sketch so the summary prompt stays small. */
function compact(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) return v.length > 20 ? { count: v.length, first: compact(v[0], depth + 1), last: compact(v[v.length - 1], depth + 1) } : v.map((x) => compact(x, depth + 1));
  if (v && typeof v === "object" && depth < 6) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, compact(x, depth + 1)]));
  return v;
}

// ---------- approval + execution ----------

export async function approve(runId: string) {
  const ctl = ctlOf(runId);
  if (ctl.run.status !== "draft") throw new Error("already approved");
  emit(ctl, { type: "run.funding" });
  const hash = planHash(ctl.run);
  const adapter = adapterFor(ctl.run);
  try {
    const { vault, fundingTx } = await adapter.open(ctl.run, hash);
    ctl.funded = BigInt(ctl.run.cap);
    emit(ctl, { type: "run.approved", planHash: hash, vault, fundingTx, at: now() });
    const big = ctl.run.lines.filter((l) => l.bigSpend);
    log(ctl, {
      kind: "plan_approval",
      what: `Plan with ${ctl.run.lines.length} spend lines`,
      why: big.length ? `Includes ${big.length} big spend(s): ${big.map((l) => l.purpose).join(", ")}` : "No big spends",
      amount: sum(ctl.run.lines.map((l) => l.approved)).toString(),
      outcome: "approved",
      by: "user",
      tx: fundingTx,
    });
  } catch (e) {
    emit(ctl, { type: "workorder.updated", run: { ...ctl.run, status: "draft", editNote: { ok: false, message: `Funding failed: ${(e as { shortMessage?: string }).shortMessage ?? (e as Error).message}` } } });
    throw e;
  }
  void execute(ctl);
  return ctl.run;
}

async function execute(ctl: Ctl) {
  const running = new Map<string, Promise<void>>();
  const terminal = (p: Phase) => p.status === "done" || p.status === "skipped";
  try {
    for (;;) {
      if (ctl.cancelled) return;
      const ready = ctl.run.phases.filter(
        (p) => p.status === "planned" && !running.has(p.id) && p.dependsOn.every((d) => terminal(ctl.run.phases.find((x) => x.id === d)!)),
      );
      for (const p of ready) running.set(p.id, runPhase(ctl, p.id).finally(() => running.delete(p.id)));
      if (running.size === 0) break;
      await Promise.race(running.values());
    }
    if (ctl.cancelled) return;
    if (ctl.run.phases.every(terminal)) await finish(ctl);
  } catch (e) {
    if (!(e instanceof Cancelled)) console.error("run failed", e);
  }
}

async function finish(ctl: Ctl) {
  const agent = AGENTS[ctl.run.agent];
  const deliverable = agent.deliver(agentCtx(ctl, "deliver"));
  if (aiEnabled() && ctl.run.method.analysis !== "ide") {
    const r = await aiSummary(ctl.run.agent, ctl.run.task, compact(deliverable.data));
    if (r) {
      trackAi(ctl, "summary", r.usage);
      deliverable.summary = r.summary.headline;
      deliverable.notes = r.summary.bullets;
    }
  }
  if (ctl.run.method.analysis === "ide") {
    deliverable.method = `${deliverable.method} · analysis in your AI IDE`;
    deliverable.contextPack = {
      prompt: `You are helping with: "${ctl.run.task}". The JSON below is data bought for this task (${deliverable.method}). Summarise what matters, flag uncertainty, keep it short.`,
      data: deliverable.data,
    };
  }
  const { refunded, txHash } = await adapterFor(ctl.run).close(ctl.run);
  emit(ctl, { type: "run.done", deliverable, refunded: refunded.toString(), refundTx: txHash, at: now() });
}

function optionsFor(code: FailureCode, phase: Phase, retryable: boolean): FailureAction[] {
  const opts: FailureAction[] = [];
  if (code === "insufficient_balance") opts.push("topup");
  else if (retryable) opts.push("retry");
  if (phase.alternatives?.length && code !== "model_error") opts.push("switch");
  if (phase.optional) opts.push("skip");
  opts.push("cancel");
  return opts;
}

async function runPhase(ctl: Ctl, phaseId: string): Promise<void> {
  const agent = AGENTS[ctl.run.agent];
  for (;;) {
    if (ctl.cancelled) throw new Cancelled();
    emit(ctl, { type: "phase.started", phaseId });
    const chargedBefore = phaseCharged(ctl, phaseId);
    try {
      await agent.runPhase(phaseId, agentCtx(ctl, phaseId));
      emit(ctl, { type: "phase.done", phaseId });
      return;
    } catch (e) {
      if (e instanceof Cancelled || ctl.cancelled) throw new Cancelled();
      const phase = ctl.run.phases.find((p) => p.id === phaseId)!;
      const code: FailureCode = e instanceof PaymentError || e instanceof PhaseFailure ? e.code : "unknown";
      const retryable = !(e instanceof PhaseFailure && e.code === "unknown");
      const failure: Failure = {
        id: id(),
        phaseId,
        code,
        message: ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).split("\n")[0].slice(0, 160),
        charged: (phaseCharged(ctl, phaseId) - chargedBefore).toString(),
        notCharged: ctl.run.phases.find((p) => p.id === phaseId)?.payments.find((p) => p.txState === "failed")?.amount ?? "0",
        options: optionsFor(code, phase, retryable),
      };
      emit(ctl, { type: "failure.raised", failure });
      const action = (await waitFor(ctl, failure.id)) as FailureAction;
      emit(ctl, { type: "failure.resolved", failureId: failure.id, action });
      log(ctl, {
        kind: "failure",
        phaseId,
        what: `${phase.label}: ${failure.message}`,
        why: code,
        outcome: action === "retry" ? "retried" : action === "skip" ? "skipped" : action === "switch" ? "switched" : action === "topup" ? "topped_up" : "cancelled",
        by: "user",
      });
      if (action === "cancel") {
        await cancel(ctl.run.id);
        throw new Cancelled();
      }
      if (action === "skip") {
        releaseLine(ctl, phase);
        emit(ctl, { type: "phase.skipped", phaseId });
        return;
      }
      if (action === "switch") ctl.seller[phaseId] = (ctl.seller[phaseId] ?? ctl.run.method.seller) === "mirror" ? "primary" : "mirror";
      if (action === "topup") {
        const amount = BigInt(ctl.run.cap) / 2n || 1_000_000n;
        await adapterFor(ctl.run).topUp(ctl.run, amount);
        ctl.funded += amount;
      }
      // retry / switch / topup: loop and run the phase again; settled purchases are cached
    }
  }
}

function releaseLine(ctl: Ctl, phase: Phase) {
  const line = ctl.run.lines.find((l) => l.id === phase.lineId);
  if (line) emit(ctl, { type: "line.updated", line: { ...line, approved: line.actual } });
}

const phaseCharged = (ctl: Ctl, phaseId: string) =>
  sum(ctl.run.phases.find((p) => p.id === phaseId)?.payments.filter((p) => p.txState === "settled").map((p) => p.amount) ?? []);

function takeFault(ctl: Ctl, phaseId: string): FailureCode | undefined {
  if (phaseId !== AGENTS[ctl.run.agent].faultPhase) return;
  const f = ctl.run.faults.find((x) => PAYMENT_FAULTS.includes(x) && !ctl.usedFaults.has(x));
  if (f) ctl.usedFaults.add(f);
  return f;
}

function agentCtx(ctl: Ctl, phaseId: string): AgentCtx {
  return {
    task: ctl.run.task,
    options: ctl.options,
    memory: ctl.memory,
    progress: (p, note) => emit(ctl, { type: "phase.progress", phaseId, progress: p, note }),
    fault: (code) => {
      if (!ctl.run.faults.includes(code) || ctl.usedFaults.has(code)) return false;
      ctl.usedFaults.add(code);
      return true;
    },
    buy: (lineId, product, params, key) => buy(ctl, phaseId, lineId, product, params, key),
  };
}

async function buy<T>(ctl: Ctl, phaseId: string, lineId: string, product: string, params: Record<string, string>, key: string): Promise<T> {
  if (ctl.cache.has(key)) return ctl.cache.get(key) as T;
  if (ctl.cancelled) throw new Cancelled();
  const adapter = adapterFor(ctl.run);
  const sellerId = ctl.seller[phaseId] ?? ctl.run.method.seller;
  const fault = takeFault(ctl, phaseId);
  const req = { product, params, seller: sellerId, fault: fault === "approval_timeout" ? "price_increase" : fault };

  const quote = await adapter.quote(req);
  const amount = BigInt(quote.maxAmountRequired);

  // Policy gate. Anything outside the approved plan goes to the user.
  for (;;) {
    const verdict = checkSpend(ctl.run, { lineId, payee: quote.payTo, amount });
    if (verdict.ok) break;
    if (verdict.reason === "not_running") throw new Cancelled();
    await requestReapproval(ctl, phaseId, lineId, product, quote.payTo, amount, verdict.reason, fault === "approval_timeout");
  }

  const line = ctl.run.lines.find((l) => l.id === lineId)!;
  const payment: Payment = { id: key, lineId, txState: "planned", amount: amount.toString() };
  const update = (p: Partial<Payment>) => {
    Object.assign(payment, p);
    emit(ctl, { type: "payment.updated", phaseId, payment: { ...payment, at: now() } });
  };
  update({});
  try {
    const { data, result } = await adapter.payX402(ctl.run, line, req, quote, (s, extra) => update({ txState: s, networkFee: extra?.fee }));
    const fresh = ctl.run.lines.find((l) => l.id === lineId)!;
    emit(ctl, { type: "line.updated", line: { ...fresh, actual: (BigInt(fresh.actual) + result.amount).toString() } });
    update({ txState: "settled", txHash: result.txHash, networkFee: result.fee });
    ctl.cache.set(key, data);
    emit(ctl, { type: "data.received", key, product, data });
    return data as T;
  } catch (e) {
    update({ txState: "failed" });
    throw e;
  }
}

async function requestReapproval(
  ctl: Ctl,
  phaseId: string,
  lineId: string,
  product: string,
  payee: Hex,
  unit: bigint,
  reason: "off_plan" | "new_payee" | "over_amount",
  forceTimeout: boolean,
) {
  const existing = ctl.run.lines.find((l) => l.id === lineId);
  const seller = Object.values(SELLERS).find((s) => s.address.toLowerCase() === payee.toLowerCase());
  const callsLeft = existing?.calls ? Math.max(1, existing.calls.max - Math.round(Number(BigInt(existing.actual) / (BigInt(existing.calls.unitPrice) || 1n)))) : 1;
  const newApproved = BigInt(existing?.actual ?? 0) + unit * BigInt(callsLeft);
  const capsAfter = sum(ctl.run.lines.filter((l) => l.id !== lineId).map((l) => l.approved)) + newApproved;
  const budgetLeft = ctl.funded - capsAfter;
  const minAmount = BigInt(existing?.actual ?? 0) + unit;

  const request: ReapprovalRequest = {
    id: id(),
    phaseId,
    lineId,
    reason:
      reason === "over_amount"
        ? "Seller asks more than approved"
        : reason === "new_payee"
          ? "Different seller than approved"
          : "Spend not in the approved plan",
    from: { amount: existing?.approved ?? "0", payeeName: existing?.payeeName ?? "—", payee: existing?.payee ?? "0x0000000000000000000000000000000000000000" },
    to: { amount: newApproved.toString(), payeeName: seller?.name ?? "Unknown seller", payee, service: PRODUCTS[product]?.description ?? product },
    budgetLeft: budgetLeft.toString(),
    minAmount: minAmount.toString(),
    expiresAt: new Date(Date.now() + (forceTimeout ? FAULT_TIMEOUT_MS : REAPPROVAL_TIMEOUT_MS)).toISOString(),
  };
  emit(ctl, { type: "reapproval.requested", request });

  const timer = setTimeout(() => ctl.waiters.get(request.id)?.("timed_out"), forceTimeout ? FAULT_TIMEOUT_MS : REAPPROVAL_TIMEOUT_MS);
  const outcome = (await waitFor(ctl, request.id)) as "approved" | "denied" | "timed_out" | "cancel";
  clearTimeout(timer);
  if (outcome === "cancel") throw new Cancelled();
  emit(ctl, { type: "reapproval.decided", requestId: request.id, outcome });

  if (outcome !== "approved") {
    log(ctl, {
      kind: "reapproval",
      phaseId,
      what: request.reason,
      why: `${request.to.service} from ${request.to.payeeName}`,
      amount: request.to.amount,
      previousAmount: request.from.amount,
      payee: payee,
      outcome,
      by: outcome === "timed_out" ? "system" : "user",
    });
    throw new PhaseFailure(outcome === "timed_out" ? "approval_timeout" : "policy_block", outcome === "timed_out" ? "No answer in time, treated as deny" : "You denied the change");
  }

  // Approved (maybe with an edited amount): apply onchain, then update the plan.
  const override = ctl.overrides.get(request.id);
  ctl.overrides.delete(request.id);
  const approvedAmount = override != null ? (override < minAmount ? minAmount : override) : newApproved;
  const shortfall = sum(ctl.run.lines.filter((l) => l.id !== lineId).map((l) => l.approved)) + approvedAmount - ctl.funded;
  const adapter = adapterFor(ctl.run);
  if (shortfall > 0n) {
    await adapter.topUp(ctl.run, shortfall);
    ctl.funded += shortfall;
  }
  const line: CostLine = existing
    ? {
        ...existing,
        payee,
        payeeName: request.to.payeeName,
        approved: approvedAmount.toString(),
        bigSpend: approvedAmount >= BigInt(ctl.run.threshold),
        calls: existing.calls ? { ...existing.calls, unitPrice: (unit > BigInt(existing.calls.unitPrice) ? unit : BigInt(existing.calls.unitPrice)).toString() } : undefined,
      }
    : {
        id: lineId,
        index: Math.max(-1, ...ctl.run.lines.map((l) => l.index)) + 1,
        phaseId,
        purpose: PRODUCTS[product]?.description ?? product,
        service: product,
        payeeName: request.to.payeeName,
        payee,
        rail: "x402",
        approved: approvedAmount.toString(),
        actual: "0",
        bigSpend: approvedAmount >= BigInt(ctl.run.threshold),
        calls: { max: 1, unitPrice: unit.toString() },
      };
  const nextLines = existing ? ctl.run.lines.map((l) => (l.id === lineId ? line : l)) : [...ctl.run.lines, line];
  const hash = planHash({ ...ctl.run, lines: nextLines });
  const tx = await adapter.setLine({ ...ctl.run, lines: nextLines }, line, hash);
  emit(ctl, { type: "line.updated", line });
  log(ctl, {
    kind: "reapproval",
    phaseId,
    what: request.reason,
    why: `${request.to.service} from ${request.to.payeeName}`,
    amount: approvedAmount.toString(),
    previousAmount: request.from.amount,
    payee,
    outcome: override != null ? "edited" : "approved",
    by: "user",
    tx,
  });
}

function waitFor(ctl: Ctl, key: string): Promise<string> {
  return new Promise((resolve) => {
    ctl.waiters.set(key, (v) => {
      ctl.waiters.delete(key);
      resolve(v);
    });
  });
}

// ---------- user decisions ----------

export function decideReapproval(runId: string, requestId: string, outcome: "approved" | "denied", amount?: string) {
  const ctl = ctlOf(runId);
  const w = ctl.waiters.get(requestId);
  if (!w) throw new Error("no pending request");
  if (outcome === "approved" && amount) ctl.overrides.set(requestId, BigInt(amount));
  w(outcome);
}

export async function setMethod(runId: string, method: Partial<Method>) {
  const ctl = ctlOf(runId);
  if (ctl.run.status !== "draft") throw new Error("work order already approved");
  const next = { ...ctl.run.method, ...method };
  ctl.run = { ...ctl.run, method: next };
  const plan = materialize(ctl, await AGENTS[ctl.run.agent].plan(ctl.run.task, ctl.options));
  emit(ctl, { type: "workorder.updated", run: { ...ctl.run, ...plan, editNote: undefined } });
  log(ctl, {
    kind: "card_edit",
    what: `Method: ${next.seller === "mirror" ? SELLERS.mirror.name : SELLERS.primary.name} · ${next.analysis === "ide" ? "your AI IDE" : "built-in analysis"}`,
    why: "Method picked",
    outcome: "edited",
    by: "user",
  });
  return ctl.run;
}

/** Dry run of a card edit: what would change, without changing anything. */
export async function previewEdit(runId: string, card: Card["kind"], prompt: string) {
  const ctl = ctlOf(runId);
  const agent = AGENTS[ctl.run.agent];
  const before = { total: sum(ctl.run.lines.map((l) => l.approved)).toString(), lines: ctl.run.lines.map((l) => ({ purpose: l.purpose, approved: l.approved })) };
  const m = prompt.match(/(\d+(?:\.\d+)?)/);
  if (card === "price" && /threshold|big spend/i.test(prompt) && m) return { ok: true, message: `Big-spend threshold → ${m[1]} USDC`, before, after: before };
  const res = await editOptions(ctl, card, prompt);
  ctl.previews.set(`${card}:${prompt}`, res);
  if (!res.ok || !res.options) return { ok: false, message: res.message, alternatives: res.alternatives };
  const plan = materialize(ctl, await agent.plan(ctl.run.task, res.options));
  return {
    ok: true,
    message: res.message,
    before,
    after: { total: sum(plan.lines.map((l) => l.approved)).toString(), lines: plan.lines.map((l) => ({ purpose: l.purpose, approved: l.approved })) },
    cards: plan.cards,
  };
}

export function resolveFailure(runId: string, failureId: string, action: FailureAction) {
  const ctl = ctlOf(runId);
  const f = ctl.run.pendingFailures.find((x) => x.id === failureId);
  if (!f || !f.options.includes(action)) throw new Error("action not offered");
  ctl.waiters.get(failureId)?.(action);
}

export async function cancel(runId: string) {
  const ctl = ctlOf(runId);
  if (ctl.cancelled || ctl.run.status === "done" || ctl.run.status === "cancelled") return ctl.run;
  ctl.cancelled = true;
  for (const [k, w] of ctl.waiters) if (!ctl.run.pendingFailures.some((f) => f.id === k)) w("cancel");
  if (ctl.run.status === "draft") {
    emit(ctl, { type: "run.cancelled", refunded: "0", at: now() });
    return ctl.run;
  }
  const { refunded, txHash } = await adapterFor(ctl.run).close(ctl.run);
  log(ctl, { kind: "failure", what: "Job cancelled", why: "Stopped by you", outcome: "cancelled", by: "user", amount: refunded.toString(), tx: txHash });
  emit(ctl, { type: "run.cancelled", refunded: refunded.toString(), refundTx: txHash, at: now() });
  return ctl.run;
}

// ---------- restart recovery ----------

/** Rebuilds runs from the event log. Runs cut off mid-flight close their vault and return funds. */
function restore() {
  const gg = globalThis as unknown as { __agentoRestored?: boolean };
  if (gg.__agentoRestored) return;
  gg.__agentoRestored = true;
  for (const saved of loadAll()) {
    if (runs.has(saved.runId) || !saved.events.length) continue;
    const run = reduceAll(saved.events);
    if (!run) continue;
    const ctl: Ctl = {
      run,
      events: saved.events,
      listeners: new Set(),
      waiters: new Map(),
      options: saved.meta.options,
      memory: {},
      cache: new Map(),
      usedFaults: new Set(),
      seller: saved.meta.seller ?? {},
      funded: BigInt(saved.meta.funded ?? "0"),
      cancelled: false,
      overrides: new Map(),
      previews: new Map(),
    };
    runs.set(run.id, ctl);
    if (run.status === "running" || run.status === "funding") void recover(ctl);
  }
}

async function recover(ctl: Ctl) {
  ctl.cancelled = true;
  const spent = sum(ctl.run.lines.map((l) => l.actual));
  let refunded = ctl.funded > spent ? ctl.funded - spent : 0n;
  let refundTx: Hex | undefined;
  if (ctl.run.mode === "live" && ctl.run.vault) {
    try {
      const r = await adapterFor(ctl.run).close(ctl.run);
      refunded = r.refunded;
      refundTx = r.txHash;
    } catch (e) {
      console.warn(`recover ${ctl.run.id}: close failed`, (e as Error).message);
      return;
    }
  }
  log(ctl, { kind: "failure", what: "Server restarted mid-run", why: "Job stopped and vault closed so funds return", outcome: "cancelled", by: "system", amount: refunded.toString(), tx: refundTx });
  emit(ctl, { type: "run.cancelled", refunded: refunded.toString(), refundTx, at: now() });
}

if (process.env.NEXT_PHASE !== "phase-production-build") restore();
