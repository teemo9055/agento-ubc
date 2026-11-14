import { keccak256, toBytes, type Hex } from "viem";
import { randomUUID } from "node:crypto";
import type { RunEvent, SeqEvent } from "@/lib/events";
import { sum } from "@/lib/money";
import { checkSpend } from "@/lib/policy";
import { reduce } from "@/lib/reducer";
import type {
  AgentId,
  Card,
  CostLine,
  Decision,
  Failure,
  FailureAction,
  FailureCode,
  Payment,
  Phase,
  ReapprovalRequest,
  Run,
} from "@/lib/types";
import { AGENTS } from "./agents";
import { PhaseFailure, type AgentCtx, type PlanDraft } from "./agents/types";
import { accounts, liveReady } from "./chain";
import { adapterFor, PaymentError } from "./payments";
import { SELLERS } from "./sellers";
import { PRODUCTS } from "./x402";

const DEFAULT_THRESHOLD = 250_000n; // 0.25 USDC
const BUFFER_PCT = 20n;
const REAPPROVAL_TIMEOUT_MS = Number(process.env.REAPPROVAL_TIMEOUT_MS ?? 120_000);
const FAULT_TIMEOUT_MS = Number(process.env.FAULT_TIMEOUT_MS ?? 8_000);
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

export function planHash(run: Pick<Run, "task" | "threshold" | "lines" | "agent">): Hex {
  const canonical = JSON.stringify({
    agent: run.agent,
    task: run.task,
    threshold: run.threshold,
    lines: run.lines.map((l) => [l.id, l.index, l.payee.toLowerCase(), l.approved, l.rail]),
  });
  return keccak256(toBytes(canonical));
}

function priceCard(lines: CostLine[], cap: bigint, threshold: bigint): Card {
  const total = sum(lines.map((l) => l.approved));
  const big = lines.filter((l) => l.bigSpend).length;
  const calls = lines.reduce((a, l) => a + (l.calls?.max ?? 0), 0);
  const f = (v: bigint) => (Number(v) / 1e6).toFixed(2);
  return {
    kind: "price",
    title: `${f(total)} USDC`,
    points: [`Cap ${f(cap)} USDC (+${BUFFER_PCT}% buffer)`, `${calls} paid requests`, big ? `${big} big ${big === 1 ? "spend" : "spends"} over ${f(threshold)}` : `No spend over ${f(threshold)}`],
  };
}

function materialize(ctl: Ctl, draft: PlanDraft) {
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
  const phases: Phase[] = draft.phases.map((p) => ({ ...p, status: "planned", payments: [] }));
  return { cards: [...draft.cards, priceCard(lines, cap, threshold)], lines, phases, cap: cap.toString() };
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
    client: accounts.client?.address ?? "0x0000000000000000000000000000000000000000",
    agentWallet: accounts.agent?.address ?? "0x0000000000000000000000000000000000000000",
    pendingReapprovals: [],
    pendingFailures: [],
    createdAt: now(),
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
    funded: 0n,
    cancelled: false,
  };
  runs.set(run.id, ctl);
  const plan = materialize(ctl, await agent.plan(run.task, ctl.options));
  emit(ctl, { type: "workorder.updated", run: { ...run, ...plan } });
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

  const res = agent.edit(card, prompt, ctl.options);
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
    emit(ctl, { type: "workorder.updated", run: { ...ctl.run, status: "draft", editNote: { ok: false, message: `Funding failed: ${(e as Error).message}` } } });
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
        message: (e as Error).message,
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
      if (action === "switch") ctl.seller[phaseId] = "mirror";
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
  const sellerId = ctl.seller[phaseId] ?? "primary";
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

  // Approved: apply onchain, then update the plan.
  const adapter = adapterFor(ctl.run);
  if (budgetLeft < 0n) {
    await adapter.topUp(ctl.run, -budgetLeft);
    ctl.funded += -budgetLeft;
  }
  const line: CostLine = existing
    ? {
        ...existing,
        payee,
        payeeName: request.to.payeeName,
        approved: newApproved.toString(),
        bigSpend: newApproved >= BigInt(ctl.run.threshold),
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
        approved: newApproved.toString(),
        actual: "0",
        bigSpend: newApproved >= BigInt(ctl.run.threshold),
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
    amount: request.to.amount,
    previousAmount: request.from.amount,
    payee,
    outcome: "approved",
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

export function decideReapproval(runId: string, requestId: string, outcome: "approved" | "denied") {
  const w = ctlOf(runId).waiters.get(requestId);
  if (!w) throw new Error("no pending request");
  w(outcome);
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
