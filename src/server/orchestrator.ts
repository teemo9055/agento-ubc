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
  FailureCode,
  Payment,
  Phase,
  ReapprovalRequest,
  Run,
} from "@/lib/types";
import { AGENTS } from "./agents";
import { aiSummary } from "./agents/ai-planning";
import { aiEnabled, type AiUsage } from "./ai";
import { exploreTurn } from "./explore";
import { cancelOrder, refreshOrder } from "./exchange";
import { stillTradable } from "./tools";
import { depositToGateway, gatewayBalance } from "./nanopay";
import { recordOrder } from "./knowledge";
import { aiEditMove } from "./edit-move";
import { offVault, type ChatMsg, type Proposal } from "@/lib/types";
import { PhaseFailure, type AgentCtx, type PlanDraft } from "./agents/types";
import { FACTORY, USDC, addresses, factoryAbi, liveReady, publicClient, vaultAbi } from "./chain";
import { planTree } from "./merkle";
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
  seller: Record<string, "primary">;
  overrides: Map<string, bigint>;
  previews: Map<string, { ok: boolean; message: string; options?: Record<string, unknown>; alternatives?: string[] }>;
  requests: Map<string, ReqCtx>;
  signedTx: Map<string, Hex>;
  funded: bigint;
  cancelled: boolean;
}

const g = globalThis as unknown as { __agentoRuns?: Map<string, Ctl> };
const runs: Map<string, Ctl> = (g.__agentoRuns ??= new Map<string, Ctl>());

const gl = globalThis as unknown as { __agentoWatchers?: Set<(run: Run) => void> };
const watchers: Set<(run: Run) => void> = (gl.__agentoWatchers ??= new Set());
/** Called with the latest run state after every event, for any run. */
export function watchAll(fn: (run: Run) => void) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

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
  if (e.type === "order.updated") {
    try {
      recordOrder(ctl.run, e.order);
    } catch (err) {
      console.warn("lesson not saved", (err as Error).message);
    }
  }
  for (const w of watchers) w(ctl.run);
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

function priceCard(all: CostLine[], cap: bigint, threshold: bigint, fees: bigint): Card {
  const lines = all.filter((l) => !offVault(l.rail));
  const order = all.find((l) => l.rail === "exchange");
  const total = sum(lines.map((l) => l.approved));
  const big = lines.filter((l) => l.bigSpend).length;
  const calls = lines.reduce((a, l) => a + (l.calls?.max ?? 0), 0);
  const f = (v: bigint) => fmt(v);
  return {
    kind: "price",
    title: `${f(total)} USDC`,
    points: [
      `Cap ${f(cap)} USDC (+${BUFFER_PCT}% buffer)`,
      `${calls} paid requests · ~${fmtFee(fees)} fees`,
      ...(order ? [`Order up to $${f(BigInt(order.approved))} on ${order.payeeName}`] : []),
      big ? `${big} big ${big === 1 ? "spend" : "spends"} over ${f(threshold)}` : `No spend over ${f(threshold)}`,
    ],
  };
}

/** The model's own card copy, when it wrote some, over the agent's default cards. */
function applyMethod(ctl: Ctl, draft: PlanDraft): PlanDraft {
  let { cards } = draft;
  const copy = ctl.options.cards as { deliverableTitle: string; deliverablePoints: string[]; riskPoints: string[] } | undefined;
  if (copy)
    cards = cards.map((c) =>
      c.kind === "deliverable" ? { ...c, title: copy.deliverableTitle, points: copy.deliverablePoints } : c.kind === "risk" ? { ...c, points: copy.riskPoints } : c,
    );
  return { ...draft, cards };
}

function materialize(ctl: Ctl, raw: PlanDraft) {
  const draft = applyMethod(ctl, raw);
  const threshold = BigInt(ctl.run.threshold);
  let idx = 0;
  const lines: CostLine[] = draft.lines.map((l) => ({
    ...l,
    index: offVault(l.rail) ? -1 : idx++,
    actual: "0",
    bigSpend: BigInt(l.approved) >= threshold,
  }));
  const total = sum(lines.filter((l) => !offVault(l.rail)).map((l) => l.approved));
  const cap = total + (total * BUFFER_PCT) / 100n;
  const txs = lines.reduce((a, l) => a + (l.rail === "x402" ? (l.calls?.max ?? 1) : 0), 0) + 3; // + approve, open, close
  const fees = EST_FEE_PER_TX * BigInt(txs);
  const phases: Phase[] = draft.phases.map((p) => ({ ...p, status: "planned", payments: [] }));
  return { cards: [...draft.cards, priceCard(lines, cap, threshold, fees)], lines, phases, cap: cap.toString(), estFees: fees.toString() };
}

type CreateInput = {
  agent: AgentId;
  task: string;
  mode?: "demo" | "live";
  faults?: FailureCode[];
  /** A move written by an outside AI (already validated): skips the chat. */
  proposal?: Proposal;
  plannedBy?: string;
  payerAddress?: Hex;
};

/**
 * Creates a job. With `wait: false` it returns at once with `planning: true` and the
 * plan arrives as a later event, so the screen never blocks on the model.
 */
export async function createRun(input: CreateInput, opts: { wait?: boolean } = {}) {
  const agent = AGENTS[input.agent];
  if (!agent) throw new Error("unknown agent");
  const mode = input.mode === "live" && liveReady() ? "live" : "demo";
  const run: Run = {
    id: id(),
    agent: input.agent,
    task: input.task.trim().slice(0, 280),
    mode,
    faults: input.faults ?? [],
    status: input.proposal ? "draft" : "exploring",
    cards: [],
    lines: [],
    phases: [],
    decisions: [],
    threshold: DEFAULT_THRESHOLD.toString(),
    cap: "0",
    client: (input.payerAddress && mode === "live" ? input.payerAddress : addresses.client) ?? "0x0000000000000000000000000000000000000000",
    agentWallet: addresses.agent ?? "0x0000000000000000000000000000000000000000",
    pendingReapprovals: [],
    pendingFailures: [],
    createdAt: now(),
    method: { seller: "primary", analysis: "builtin" },
    planner: "rules",
    payer: input.payerAddress && mode === "live" ? "passkey" : "server",
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
    requests: new Map(),
    signedTx: new Map(),
    funded: 0n,
    cancelled: false,
  };
  runs.set(run.id, ctl);
  if (input.proposal) {
    emit(ctl, { type: "workorder.updated", run: { ...run, planner: "ai", ai: { model: input.plannedBy ?? "your AI (MCP)", calls: 0, promptTokens: 0, completionTokens: 0 } } });
    await adoptProposal(ctl, input.proposal);
    return ctl.run;
  }
  emit(ctl, { type: "workorder.updated", run: { ...run, chat: [] } });
  const first = sendChat(run.id, input.task);
  if (opts.wait !== false) await first;
  return ctl.run;
}

/** Turns an agreed move into a priced work order the user approves. */
async function adoptProposal(ctl: Ctl, proposal: Proposal) {
  ctl.options = { ...ctl.options, proposal };
  const plan = materialize(ctl, await AGENTS[ctl.run.agent].plan(ctl.run.task, ctl.options));
  emit(ctl, { type: "workorder.updated", run: { ...ctl.run, ...plan, status: "draft", proposal, planning: false, editNote: undefined } });
}

const chatBusy = new Set<string>();

/** One explore turn: the user's message, the agent's free lookups, its reply and maybe a move. */
export function sendChat(runId: string, text: string): Promise<Run> {
  const ctl = ctlOf(runId);
  if (!["exploring", "draft"].includes(ctl.run.status)) throw new Error("this job is already running");
  if (chatBusy.has(runId)) throw new Error("the agent is still answering");
  const msg: ChatMsg = { id: id(), role: "user", text: text.trim().slice(0, 600), at: now() };
  if (!msg.text) throw new Error("empty message");
  chatBusy.add(runId);
  emit(ctl, { type: "chat.message", message: msg });
  emit(ctl, { type: "chat.thinking", note: "Thinking" });
  return agentReply(ctl);
}

const YES = /^(yes|yep|yeah|yup|ok|okay|sure|do it|set it up|go|go ahead|sounds good|let'?s do it)\b[\s.!]*$/i;

async function agentReply(ctl: Ctl) {
  const runId = ctl.run.id;
  const chat = ctl.run.chat ?? [];
  const said = chat[chat.length - 1]?.text ?? "";
  const latest = [...chat].reverse().find((m) => m.role === "agent")?.proposal;
  // A plain "yes" to the move just shown means: set it up. No need to ask the model again.
  if (YES.test(said.trim()) && latest && ctl.run.status === "exploring") {
    try {
      emit(ctl, { type: "chat.message", message: { id: id(), role: "agent", text: "Set up. Review the work order and approve it when you're ready.", at: now() } });
      await adoptProposal(ctl, latest);
      log(ctl, { kind: "card_edit", what: `Move chosen: ${latest.title}`, why: latest.ask, outcome: "approved", by: "user" });
    } finally {
      chatBusy.delete(runId);
    }
    return ctl.run;
  }
  try {
    const r = await exploreTurn(ctl.run.agent, ctl.run.chat ?? [], (note) => emit(ctl, { type: "chat.thinking", note }), id());
    for (const u of r.usage) trackAi(ctl, "chat", u);
    if (r.usage.length) ctl.run = { ...ctl.run, planner: "ai" };
    emit(ctl, { type: "chat.message", message: { id: id(), role: "agent", text: r.text, at: now(), tools: r.tools, facts: r.facts, proposal: r.proposal, suggestions: r.suggestions } });
  } catch (e) {
    console.warn("chat failed", e);
    emit(ctl, { type: "chat.message", message: { id: id(), role: "agent", text: "Something went wrong looking that up. Try again?", at: now() } });
  } finally {
    chatBusy.delete(runId);
  }
  return ctl.run;
}

/** The user said yes to a move from the chat. */
export async function adopt(runId: string, proposalId: string) {
  const ctl = ctlOf(runId);
  if (!["exploring", "draft"].includes(ctl.run.status)) throw new Error("this job is already running");
  const p = [...(ctl.run.chat ?? [])].reverse().find((m) => m.proposal?.id === proposalId)?.proposal;
  if (!p) throw new Error("move not found");
  await adoptProposal(ctl, p);
  log(ctl, { kind: "card_edit", what: `Move chosen: ${p.title}`, why: p.ask, outcome: "approved", by: "user" });
  return ctl.run;
}

/** Back to chat from the work order, keeping the conversation. */
export function backToChat(runId: string) {
  const ctl = ctlOf(runId);
  // Already back in chat (e.g. a second click, or a message sent right after): nothing to do.
  if (ctl.run.status === "exploring") return ctl.run;
  if (ctl.run.status !== "draft") throw new Error("only before approval");
  emit(ctl, { type: "workorder.updated", run: { ...ctl.run, status: "exploring", cards: [], lines: [], phases: [], proposal: undefined, editNote: undefined } });
  return ctl.run;
}

const ctlOf = (runId: string) => {
  const ctl = runs.get(runId);
  if (!ctl) throw new Error("run not found");
  return ctl;
};

export async function editCard(runId: string, card: Card["kind"], prompt: string, step?: string) {
  const ctl = ctlOf(runId);
  if (ctl.run.status !== "draft") throw new Error("work order already approved");
  const agent = AGENTS[ctl.run.agent];

  if (card === "price" && !step) {
    const m = prompt.match(/(\d+(?:\.\d+)?)/);
    if (/threshold|big spend/i.test(prompt) && m) {
      ctl.run.threshold = BigInt(Math.round(Number(m[1]) * 1e6)).toString();
      const plan = materialize(ctl, await agent.plan(ctl.run.task, ctl.options));
      emit(ctl, { type: "workorder.updated", run: { ...ctl.run, ...plan, editNote: { ok: true, message: `Big-spend threshold set to ${m[1]} USDC` } } });
      return ctl.run;
    }
  }

  const key = `${step ? `step:${step}` : card}:${prompt}`;
  const res = ctl.previews.get(key) ?? (await editOptions(ctl, card, prompt, step));
  ctl.previews.clear();
  if (res.ok && res.options) {
    const before = ctl.run.cards.find((c) => c.kind === "price")?.title;
    ctl.options = res.options;
    const plan = materialize(ctl, await agent.plan(ctl.run.task, ctl.options));
    const after = plan.cards.find((c) => c.kind === "price")?.title;
    emit(ctl, {
      type: "workorder.updated",
      run: { ...ctl.run, ...plan, proposal: (ctl.options.proposal as Proposal | undefined) ?? ctl.run.proposal, editNote: { ok: true, message: before === after ? res.message : `${res.message} · ${before} → ${after}` } },
    });
  } else {
    emit(ctl, { type: "workorder.updated", run: { ...ctl.run, editNote: { ok: false, message: res.message, alternatives: res.alternatives } } });
  }
  log(ctl, { kind: "card_edit", what: `${step ? `step “${ctl.run.phases.find((p) => p.id === step)?.label ?? step}”` : card}: ${prompt}`, why: res.message, outcome: res.ok ? "edited" : "rejected", by: "user" });
  return ctl.run;
}

function trackAi(ctl: Ctl, purpose: string, usage: AiUsage) {
  emit(ctl, { type: "ai.used", purpose, usage });
}

/** AI edit first (keeps the model's card copy in sync), rule-based edit as fallback. */
async function editOptions(ctl: Ctl, card: Card["kind"], prompt: string, step?: string) {
  const current = ctl.options.proposal as Proposal | undefined;
  if (current && aiEnabled()) {
    const ai = await aiEditMove(ctl.run.agent, current, prompt, step).catch((e) => (console.warn("ai edit", (e as Error).message), null));
    if (ai) {
      trackAi(ctl, "edit", ai.usage);
      return ai.ok && ai.proposal ? { ok: true, message: ai.message, options: { ...ctl.options, proposal: ai.proposal } } : { ok: false, message: ai.message, alternatives: ai.alternatives };
    }
  }
  const r = AGENTS[ctl.run.agent].edit(card, prompt, ctl.options, step);
  return r.ok && r.options ? { ...r, options: { ...ctl.options, ...r.options } } : r;
}

/** Large arrays (price series) become a short sketch so the summary prompt stays small. */
function compact(v: unknown, depth = 0): unknown {
  if (Array.isArray(v)) return v.length > 20 ? { count: v.length, first: compact(v[0], depth + 1), last: compact(v[v.length - 1], depth + 1) } : v.map((x) => compact(x, depth + 1));
  if (v && typeof v === "object" && depth < 6) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, compact(x, depth + 1)]));
  return v;
}

// ---------- approval + execution ----------

/** What the user's own wallet needs to sign to fund this work order. */
export function fundingInfo(runId: string) {
  const ctl = ctlOf(runId);
  if (ctl.run.payer !== "passkey") throw new Error("this job is funded by the server wallet");
  return {
    factory: FACTORY,
    usdc: USDC,
    agent: addresses.agent,
    planRoot: planTree(ctl.run.lines).root as Hex,
    orderId: planHash(ctl.run),
    cap: ctl.run.cap,
    payer: ctl.run.client,
  };
}

/** Confirms onchain that the user's wallet opened the right vault for this plan. */
async function verifyUserFunding(run: Run, orderId: Hex) {
  if (!FACTORY) throw new Error("live mode is not configured");
  const vault = await publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "vaultFor", args: [run.client, orderId] });
  const read = (functionName: "payer" | "agent" | "planRoot" | "funded" | "closed") =>
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName } as never) as Promise<unknown>;
  for (let i = 0; i < 6; i++) {
    try {
      const [payer, agent, root, funded, closed] = await Promise.all([read("payer"), read("agent"), read("planRoot"), read("funded"), read("closed")]);
      const ok =
        String(payer).toLowerCase() === run.client.toLowerCase() &&
        String(agent).toLowerCase() === String(addresses.agent).toLowerCase() &&
        root === planTree(run.lines).root &&
        BigInt(funded as bigint) >= BigInt(run.cap) &&
        !closed;
      if (ok) return vault;
    } catch {
      // not deployed yet: wait for the chain
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Couldn't find a funded vault for this plan onchain");
}

export async function approve(runId: string, signed?: { txHash?: Hex }) {
  const ctl = ctlOf(runId);
  if (ctl.run.status !== "draft") throw new Error("already approved");
  if (ctl.run.planning) throw new Error("still planning");
  if (ctl.run.proposal) {
    const stale = await stillTradable(ctl.run.proposal);
    if (stale) throw new Error(stale);
  }
  const noVault = BigInt(ctl.run.cap) === 0n;
  if (ctl.run.payer === "passkey" && !signed?.txHash && !noVault) throw new Error("sign the funding with your passkey wallet first");
  emit(ctl, { type: "run.funding" });
  const hash = planHash(ctl.run);
  const adapter = adapterFor(ctl.run);
  try {
    const { vault, fundingTx } =
      // A move with no paid research spends nothing from USDC, so no vault is opened.
      noVault ? {} : ctl.run.payer === "passkey" ? { vault: await verifyUserFunding(ctl.run, hash), fundingTx: signed!.txHash } : await adapter.open(ctl.run, hash);
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
  if (aiEnabled()) {
    const r = await aiSummary(ctl.run.agent, ctl.run.proposal ? `${ctl.run.proposal.ask} (user first asked: ${ctl.run.task})` : ctl.run.task, compact(deliverable.data));
    if (r) {
      trackAi(ctl, "summary", r.usage);
      deliverable.summary = r.summary.headline;
      deliverable.notes = r.summary.bullets;
    }
  }
  const { refunded, txHash } = await closeVault(ctl.run);
  emit(ctl, { type: "run.done", deliverable, refunded: refunded.toString(), refundTx: txHash, at: now() });
}

/** Closes the vault and refunds what's left; nothing to do when no vault was opened. */
async function closeVault(run: Run): Promise<{ refunded: bigint; txHash?: Hex }> {
  if (run.mode === "live" && !run.vault) return { refunded: 0n };
  return adapterFor(run).close(run);
}

function optionsFor(code: FailureCode, phase: Phase, retryable: boolean): FailureAction[] {
  const opts: FailureAction[] = [];
  if (code === "insufficient_balance") opts.push("topup");
  else if (retryable) opts.push("retry");
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
        outcome: action === "retry" ? "retried" : action === "skip" ? "skipped" : action === "topup" ? "topped_up" : "cancelled",
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
      if (action === "topup") {
        if (ctl.run.payer === "passkey" && ctl.run.mode === "live") {
          // The user's wallet signed the top-up; read the new balance from the vault.
          ctl.funded = BigInt(await publicClient.readContract({ address: ctl.run.vault!, abi: vaultAbi, functionName: "funded" }));
        } else {
          const amount = BigInt(ctl.run.cap) / 2n || 1_000_000n;
          await adapterFor(ctl.run).topUp(ctl.run, amount);
          ctl.funded += amount;
        }
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
  const target = ctl.run.phases.some((p) => p.id === AGENTS[ctl.run.agent].faultPhase) ? AGENTS[ctl.run.agent].faultPhase : ctl.run.lines.find((l) => l.rail === "x402")?.phaseId;
  if (phaseId !== target) return;
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
    order: (o) => emit(ctl, { type: "order.updated", order: o }),
    buyMarketplace: (lineId, key, product, fetcher) => buyMarketplace(ctl, phaseId, lineId, key, product, fetcher),
  };
}

async function buy<T>(ctl: Ctl, phaseId: string, lineId: string, product: string, params: Record<string, string>, key: string): Promise<T> {
  if (ctl.cache.has(key)) return ctl.cache.get(key) as T;
  if (ctl.cancelled) throw new Cancelled();
  const adapter = adapterFor(ctl.run);
  const sellerId = "primary" as const;
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

/**
 * Buys from a Circle Agent Marketplace seller with a Gateway nanopayment. Same rules as vault
 * spends: an approved line, its payee, its price. Paid from the agent's Gateway balance.
 */
async function buyMarketplace<T>(ctl: Ctl, phaseId: string, lineId: string, key: string, product: string, fetcher: () => Promise<T & { paid: { amountUsdc: number; payTo: string; via: string } }>): Promise<T> {
  if (ctl.cache.has(key)) return ctl.cache.get(key) as T;
  if (ctl.cancelled) throw new Cancelled();
  const line = ctl.run.lines.find((l) => l.id === lineId);
  if (!line) throw new PhaseFailure("policy_block", "No approved line for this purchase");
  const unit = BigInt(line.calls?.unitPrice ?? line.approved);
  const verdict = checkSpend(ctl.run, { lineId, payee: line.payee, amount: unit });
  if (!verdict.ok) throw new PhaseFailure("policy_block", verdict.detail);
  await ensureGateway();
  const payment: Payment = { id: key, lineId, txState: "signing", amount: unit.toString(), via: "Circle Gateway nanopayment" };
  emit(ctl, { type: "payment.updated", phaseId, payment: { ...payment, at: now() } });
  try {
    const got = await fetcher();
    const paid = BigInt(Math.round(got.paid.amountUsdc * 1e6));
    // The seller's price must match what was approved; anything else is refused, never paid silently.
    if (paid > unit || got.paid.payTo.toLowerCase() !== line.payee.toLowerCase()) throw new PhaseFailure("policy_block", "Seller's price or payee changed");
    const fresh = ctl.run.lines.find((l) => l.id === lineId)!;
    emit(ctl, { type: "line.updated", line: { ...fresh, actual: (BigInt(fresh.actual) + paid).toString() } });
    emit(ctl, { type: "payment.updated", phaseId, payment: { ...payment, txState: "settled", amount: paid.toString(), at: now() } });
    ctl.cache.set(key, got);
    emit(ctl, { type: "data.received", key, product, data: got });
    return got;
  } catch (e) {
    emit(ctl, { type: "payment.updated", phaseId, payment: { ...payment, txState: "failed", at: now() } });
    if (e instanceof PhaseFailure) throw e;
    throw new PaymentError("payment_rejected", `Marketplace purchase failed: ${(e as Error).message.slice(0, 140)}`);
  }
}

/** Keeps a little USDC in the agent's Gateway balance for marketplace nanopayments. */
async function ensureGateway() {
  const min = Number(process.env.GATEWAY_MIN_BALANCE ?? 0.05);
  const topUp = Number(process.env.GATEWAY_TOPUP ?? 1);
  const bal = await gatewayBalance().catch(() => 0);
  if (bal >= min) return;
  await depositToGateway(topUp);
  for (let i = 0; i < 40 && (await gatewayBalance().catch(() => 0)) < min; i++) await new Promise((r) => setTimeout(r, 3000));
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
  ctl.requests.set(request.id, { existing, lineId, phaseId, product, payee, unit, minAmount, newApproved, payeeName: request.to.payeeName });
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
  const change = planChange(ctl, request.id, override);
  const { line, approvedAmount } = change;
  let tx: Hex | undefined;
  if (ctl.run.payer === "passkey") {
    // The user's wallet already signed setPlan (and any top-up); confirm it onchain.
    tx = ctl.signedTx.get(request.id);
    ctl.signedTx.delete(request.id);
    const onchain = await publicClient.readContract({ address: ctl.run.vault!, abi: vaultAbi, functionName: "planRoot" });
    if (onchain !== change.root) throw new PhaseFailure("policy_block", "The plan change wasn't found onchain, so nothing extra was spent");
    ctl.funded = BigInt(await publicClient.readContract({ address: ctl.run.vault!, abi: vaultAbi, functionName: "funded" }));
  } else {
    const adapter = adapterFor(ctl.run);
    if (change.shortfall > 0n) {
      await adapter.topUp(ctl.run, change.shortfall);
      ctl.funded += change.shortfall;
    }
    tx = await adapter.setLine({ ...ctl.run, lines: change.nextLines }, line, planHash({ ...ctl.run, lines: change.nextLines }));
  }
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

interface ReqCtx {
  existing?: CostLine;
  lineId: string;
  phaseId: string;
  product: string;
  payee: Hex;
  unit: bigint;
  minAmount: bigint;
  newApproved: bigint;
  payeeName: string;
}

/** The plan after a re-approval: new line, new Merkle root and any top-up needed. Same math for server and user wallets. */
function planChange(ctl: Ctl, requestId: string, override?: bigint) {
  const r = ctl.requests.get(requestId);
  if (!r) throw new Error("unknown request");
  const approvedAmount = override != null ? (override < r.minAmount ? r.minAmount : override) : r.newApproved;
  const shortfall = sum(ctl.run.lines.filter((l) => l.id !== r.lineId).map((l) => l.approved)) + approvedAmount - ctl.funded;
  const line: CostLine = r.existing
    ? {
        ...r.existing,
        payee: r.payee,
        payeeName: r.payeeName,
        approved: approvedAmount.toString(),
        bigSpend: approvedAmount >= BigInt(ctl.run.threshold),
        calls: r.existing.calls ? { ...r.existing.calls, unitPrice: (r.unit > BigInt(r.existing.calls.unitPrice) ? r.unit : BigInt(r.existing.calls.unitPrice)).toString() } : undefined,
      }
    : {
        id: r.lineId,
        index: Math.max(-1, ...ctl.run.lines.map((l) => l.index)) + 1,
        phaseId: r.phaseId,
        purpose: PRODUCTS[r.product]?.description ?? r.product,
        service: r.product,
        payeeName: r.payeeName,
        payee: r.payee,
        rail: "x402",
        approved: approvedAmount.toString(),
        actual: "0",
        bigSpend: approvedAmount >= BigInt(ctl.run.threshold),
        calls: { max: 1, unitPrice: r.unit.toString() },
      };
  const nextLines = r.existing ? ctl.run.lines.map((l) => (l.id === r.lineId ? line : l)) : [...ctl.run.lines, line];
  return { line, nextLines, approvedAmount, shortfall: shortfall > 0n ? shortfall : 0n, root: planTree(nextLines).root as Hex };
}

/** What the user's wallet signs to approve a change: the new plan root, plus a top-up if the vault is short. */
export function reapprovalPlan(runId: string, requestId: string, amount?: string) {
  const ctl = ctlOf(runId);
  const c = planChange(ctl, requestId, amount ? BigInt(amount) : undefined);
  return { vault: ctl.run.vault, usdc: USDC, planRoot: c.root, topUp: c.shortfall.toString(), approvedAmount: c.approvedAmount.toString() };
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

export function decideReapproval(runId: string, requestId: string, outcome: "approved" | "denied", amount?: string, txHash?: Hex) {
  const ctl = ctlOf(runId);
  const w = ctl.waiters.get(requestId);
  if (!w) throw new Error("no pending request");
  if (outcome === "approved" && ctl.run.payer === "passkey" && !txHash) throw new Error("sign the change with your passkey wallet first");
  if (outcome === "approved" && amount) ctl.overrides.set(requestId, BigInt(amount));
  if (txHash) ctl.signedTx.set(requestId, txHash);
  w(outcome);
}

/** Dry run of a card edit: what would change, without changing anything. */
export async function previewEdit(runId: string, card: Card["kind"], prompt: string, step?: string) {
  const ctl = ctlOf(runId);
  const agent = AGENTS[ctl.run.agent];
  const before = { total: sum(ctl.run.lines.map((l) => l.approved)).toString(), lines: ctl.run.lines.map((l) => ({ purpose: l.purpose, approved: l.approved })) };
  const m = prompt.match(/(\d+(?:\.\d+)?)/);
  if (card === "price" && !step && /threshold|big spend/i.test(prompt) && m) return { ok: true, message: `Big-spend threshold → ${m[1]} USDC`, before, after: before };
  const res = await editOptions(ctl, card, prompt, step);
  ctl.previews.set(`${step ? `step:${step}` : card}:${prompt}`, res);
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

export function resolveFailure(runId: string, failureId: string, action: FailureAction, txHash?: Hex) {
  const ctl = ctlOf(runId);
  if (action === "topup" && ctl.run.payer === "passkey" && ctl.run.mode === "live" && !txHash) throw new Error("sign the top-up with your passkey wallet first");
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
  const { refunded, txHash } = await closeVault(ctl.run);
  if (ctl.run.order?.status === "open" && ctl.run.proposal?.action) {
    const next = await cancelOrder(ctl.run.order, ctl.run.proposal.action.kind).catch(() => null);
    if (next) emit(ctl, { type: "order.updated", order: next });
  }
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
      requests: new Map(),
      signedTx: new Map(),
    };
    run.payer ??= "server";
    runs.set(run.id, ctl);
    if (run.planning) ctl.run = { ...run, planning: false, editNote: { ok: false, message: "Planning was interrupted by a restart. Start the job again." } };
    if (run.thinking) emit(ctl, { type: "chat.message", message: { id: id(), role: "agent", text: "I was interrupted by a restart before answering. Could you send that again?", at: now() } });
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
      const r = await closeVault(ctl.run);
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

if (process.env.NEXT_PHASE !== "phase-production-build") {
  restore();
  trackOpenOrders();
}

/** Keeps resting orders current while nobody is looking: fills, partial fills, cancels on the exchange. */
function trackOpenOrders() {
  const gg = globalThis as unknown as { __agentoOrderPoll?: ReturnType<typeof setInterval> };
  if (gg.__agentoOrderPoll) return;
  const every = Number(process.env.ORDER_POLL_MS ?? 60_000);
  gg.__agentoOrderPoll = setInterval(() => {
    for (const ctl of runs.values()) {
      const o = ctl.run.order;
      if (o?.status !== "open" || o.venue === "paper") continue;
      void refreshRunOrder(ctl.run.id).then(
        (run) => {
          if (run.order?.status === "filled" && o.status !== "filled")
            log(ctl, { kind: "failure", what: `Order filled: ${o.detail}`, why: `${run.order.filledQuantity ?? ""} filled on the exchange`, outcome: "approved", by: "system" });
        },
        (e) => console.warn(`order poll ${ctl.run.id}:`, (e as Error).message),
      );
    }
  }, every);
  gg.__agentoOrderPoll.unref?.();
}

// ---------- the order after the job ----------

/** Re-reads the move's order from the exchange: open, partly filled, filled or cancelled. */
export async function refreshRunOrder(runId: string) {
  const ctl = ctlOf(runId);
  const o = ctl.run.order;
  const kind = ctl.run.proposal?.action?.kind;
  if (!o || !kind || !["open", "filled"].includes(o.status)) return ctl.run;
  const next = await refreshOrder(o, kind);
  if (JSON.stringify(next) !== JSON.stringify(o)) emit(ctl, { type: "order.updated", order: next });
  return ctl.run;
}

/** Cancels the move's resting order. Fills that already happened stay. */
export async function cancelRunOrder(runId: string) {
  const ctl = ctlOf(runId);
  const o = ctl.run.order;
  const kind = ctl.run.proposal?.action?.kind;
  if (!o || !kind || o.status !== "open") throw new Error("no open order to cancel");
  const next = await cancelOrder(o, kind);
  emit(ctl, { type: "order.updated", order: next });
  log(ctl, { kind: "failure", what: `Order cancelled: ${o.detail}`, why: "Cancelled by you", outcome: "cancelled", by: "user" });
  return ctl.run;
}
