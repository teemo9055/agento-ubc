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
import { buildPlanStep, exploreTurn } from "./explore";
import { editPlan, type PlanOp } from "./plan-edit";
import { routeAgent } from "./route";
import { cancelOrder, marketBase, refreshOrder } from "./exchange";
import * as gemini from "./gemini";
import { settle } from "@/lib/settle";
import { stillTradable, toProposalInput, validateProposal } from "./tools";
import { ensureGatewayFunds, GatewayFundsError } from "./nanopay";
import { withNet } from "./netContext";
import { anchorOrder, canAnchor } from "./anchor";
import { suggestionsFor } from "./suggest";
import { recordOrder, recordSettlement } from "./knowledge";
import { aiEditMove } from "./edit-move";
import { offVault, paidInUsdc, type ChatMsg, type Plan, type PlanStep, type Proposal } from "@/lib/types";
import { PhaseFailure, SkipPhase, type AgentCtx, type PlanDraft } from "./agents/types";
import { MAINNET_MAX_JOB_USD, chainOf, factoryAbi, liveReady, setupProblems, vaultAbi } from "./chain";
import type { Net } from "@/lib/networks";
import { planTree } from "./merkle";
import { adapterFor, PaymentError } from "./payments";
import { SELLERS } from "./sellers";
import { PRODUCTS } from "./x402";
import { checkDelivery, DeliveryError, MaybeChargedError, type DeliveryPromise, type DeliveryVerdict } from "./delivery";
import { recordDelivery, standing } from "./strikes";
import { recordOutcome } from "./catalog/store";
import { tally } from "./verdict";

import { limits } from "./settings";
import { partsProgress } from "@/lib/parts";
import { diffMoves } from "./move-diff";
import { applyAdjust, type AdjustKind } from "@/lib/adjust";
import { askOf, titleOf } from "@/lib/plain";
import { lookupCost, maxCost } from "@/lib/move";
const BUFFER_PCT = 20n;
const REAPPROVAL_TIMEOUT_MS = Number(process.env.REAPPROVAL_TIMEOUT_MS ?? 120_000);
const FAULT_TIMEOUT_MS = Number(process.env.FAULT_TIMEOUT_MS ?? 8_000);
/** Measured on Arc testnet: one vault authorize/pay call. 18-decimal native USDC. */
const EST_FEE_PER_TX = 2_600_000_000_000_000n;
const PAYMENT_FAULTS: FailureCode[] = ["seller_402_timeout", "payment_rejected", "settle_fails", "insufficient_balance", "price_increase", "approval_timeout", "bad_delivery"];

type Waiter = (v: string) => void;

interface Ctl {
  run: Run;
  /** An order fingerprint is being written; only one per job. */
  anchoring?: boolean;
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
    // First sight of a real order: fingerprint it onchain. Never blocks or fails the job.
    if (canAnchor(ctl.run, e.order) && !ctl.anchoring) {
      ctl.anchoring = true;
      const placed = e.order;
      void anchorOrder(ctl.run, placed).then(
        (anchor) => {
          const cur = ctl.run.order;
          if (cur && cur.orderId === placed.orderId) emit(ctl, { type: "order.updated", order: { ...cur, anchor } });
          log(ctl, { kind: "failure", what: "Order fingerprint written to Arc", why: `Hash of the order record (${anchor.digest.slice(0, 10)}…), so it can be checked later`, outcome: "approved", by: "system", tx: anchor.tx as Hex });
        },
        (err) => console.warn(`anchor ${ctl.run.id}:`, (err as Error).message),
      );
    }
  }
  // A step of a plan changed: let the plan take its next step.
  if (ctl.run.parentId && ["run.done", "run.cancelled", "order.updated", "failure.raised", "failure.resolved", "reapproval.requested", "reapproval.decided", "run.approved", "phase.started", "phase.done", "phase.skipped"].includes(e.type))
    void advancePlan(ctl.run.parentId);
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
  const lines = all.filter((l) => paidInUsdc(l.rail));
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
  /** Arc testnet (test USDC) or Arc mainnet (real money). Practice jobs never touch either. */
  network?: Net;
};

/**
 * Creates a job. With `wait: false` it returns at once with `planning: true` and the
 * plan arrives as a later event, so the screen never blocks on the model.
 */
export async function createRun(input: CreateInput, opts: { wait?: boolean; quiet?: boolean } = {}) {
  const agent = AGENTS[input.agent];
  if (!agent) throw new Error("unknown agent");
  const network: Net = input.network === "mainnet" ? "mainnet" : "testnet";
  // Real money is never a silent fallback: a mainnet job that can't pay for real says so instead of turning into practice.
  if (network === "mainnet" && input.mode === "live" && !liveReady("mainnet")) throw new Error(`Arc mainnet isn't set up on this server yet: ${setupProblems("mainnet")[0] ?? "missing configuration"}`);
  const mode = input.mode === "live" && liveReady(network) ? "live" : "demo";
  const net = chainOf(network);
  const run: Run = {
    id: id(),
    agent: input.agent,
    task: input.task.trim().slice(0, 1000),
    mode,
    faults: input.faults ?? [],
    status: input.proposal ? "draft" : "exploring",
    cards: [],
    lines: [],
    phases: [],
    decisions: [],
    threshold: BigInt(Math.round(limits().bigSpendUsdc * 1e6)).toString(),
    cap: "0",
    network: mode === "live" ? network : undefined,
    client: (input.payerAddress && mode === "live" ? input.payerAddress : net.addresses.client) ?? "0x0000000000000000000000000000000000000000",
    agentWallet: net.addresses.agent ?? "0x0000000000000000000000000000000000000000",
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
  // Quiet: the request is recorded but no agent answers it (someone else brings the plan).
  if (opts.quiet) {
    emit(ctl, { type: "chat.message", message: { id: id(), role: "user", text: run.task, at: now() } });
    return ctl.run;
  }
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
  const msg: ChatMsg = { id: id(), role: "user", text: text.trim().slice(0, 1000), at: now() };
  if (!msg.text) throw new Error("empty message");
  chatBusy.add(runId);
  emit(ctl, { type: "chat.message", message: msg });
  emit(ctl, { type: "chat.thinking", note: "Thinking" });
  return agentReply(ctl);
}

const YES = /^(yes|yep|yeah|yup|ok|okay|sure|do it|set it up|go|go ahead|sounds good|let'?s do it)\b[\s.!]*$/i;

/** Runs inside the job's network, so lookups and purchases deep below follow it. */
function agentReply(ctl: Ctl) {
  return withNet(ctl.run.network, () => agentReplyInNet(ctl));
}

async function agentReplyInNet(ctl: Ctl) {
  const runId = ctl.run.id;
  const chat = ctl.run.chat ?? [];
  const said = chat[chat.length - 1]?.text ?? "";
  const lastAgent = [...chat].reverse().find((m) => m.role === "agent");
  const latest = lastAgent?.proposal;
  if (YES.test(said.trim()) && lastAgent?.plan && ctl.run.status === "exploring" && ctl.run.plan?.status !== "running") {
    chatBusy.delete(runId);
    await startPlan(runId, lastAgent.plan.id);
    return ctl.run;
  }
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
    emit(ctl, { type: "chat.message", message: { id: id(), role: "agent", text: r.text, at: now(), tools: r.tools, facts: r.facts, unverified: r.unverified, proposal: r.proposal, plan: r.plan, brief: r.brief, options: r.options, suggestions: r.options ? [] : suggestionsFor(ctl.run.agent, r.suggestions, { proposal: r.proposal, plan: Boolean(r.plan) }) } });
  } catch (e) {
    console.warn("chat failed", e);
    emit(ctl, { type: "chat.message", message: { id: id(), role: "agent", text: "Something went wrong on my side before I could answer. Nothing was spent.", at: now(), suggestions: ["Try again"] } });
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

const adjusting = new Set<string>();

/**
 * One of the quick changes to the move on screen (a bit more, a bit less, a different price…),
 * applied and re-checked by code with no model in between, so the screen updates right away.
 * The move keeps its place in the conversation; while reviewing, the work order is rebuilt from it.
 */
export async function adjustMove(runId: string, kind: AdjustKind) {
  const ctl = ctlOf(runId);
  if (!["exploring", "draft"].includes(ctl.run.status)) throw new Error("this job is already running");
  if (chatBusy.has(runId) || adjusting.has(runId)) throw new Error("one change at a time: the last one is still being worked out");
  const chat = ctl.run.chat ?? [];
  const at = ctl.run.status === "draft" ? chat.findLastIndex((m) => m.proposal?.id === ctl.run.proposal?.id) : chat.findLastIndex((m) => Boolean(m.proposal));
  const prev = ctl.run.status === "draft" ? ctl.run.proposal : chat[at]?.proposal;
  if (!prev) throw new Error("there is no move to change");
  adjusting.add(runId);
  try {
    const v = await validateProposal(ctl.run.agent, applyAdjust(toProposalInput(prev), prev, kind), prev.id);
    if ("error" in v) throw new Error(v.error.split(". ")[0]);
    const changes = diffMoves(prev, v.proposal);
    if (!changes.length) throw new Error(prev.budgetUsd != null && kind === "more" ? `That's all your $${prev.budgetUsd} allows` : "That's as far as it goes");
    // The agent wrote the name and the question around the old numbers, so code rewrites both from the move as it now is.
    const next: Proposal = { ...v.proposal, title: titleOf(v.proposal), ask: askOf(v.proposal), changes };
    // The card in the conversation shows the move as it now stands, with the same quick changes recomputed.
    const updated = at >= 0 ? chat.map((m, i) => (i === at ? { ...m, proposal: next } : m)) : chat;
    ctl.run = { ...ctl.run, chat: updated };
    if (ctl.run.status === "draft") await adoptProposal(ctl, next);
    else emit(ctl, { type: "workorder.updated", run: { ...ctl.run } });
    log(ctl, { kind: "card_edit", what: `Changed: ${changes.join(" · ")}`.slice(0, 200), why: "Quick change, checked against the market and your limits", outcome: "edited", by: "user" });
    return ctl.run;
  } finally {
    adjusting.delete(runId);
  }
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
/** Runs inside the job's network, so lookups and purchases deep below follow it. */
function editOptions(ctl: Ctl, card: Card["kind"], prompt: string, step?: string) {
  return withNet(ctl.run.network, () => editOptionsInNet(ctl, card, prompt, step));
}

async function editOptionsInNet(ctl: Ctl, card: Card["kind"], prompt: string, step?: string) {
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
  const net = chainOf(ctl.run.network);
  return {
    network: ctl.run.network ?? "testnet",
    factory: net.factory,
    usdc: net.usdc,
    agent: net.addresses.agent,
    planRoot: planTree(ctl.run.lines).root as Hex,
    orderId: planHash(ctl.run),
    cap: ctl.run.cap,
    payer: ctl.run.client,
  };
}

/** Confirms onchain that the user's wallet opened the right vault for this plan. */
async function verifyUserFunding(run: Run, orderId: Hex) {
  const { factory: FACTORY, publicClient, addresses } = chainOf(run.network);
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
  const jobMax = BigInt(Math.round(limits().maxJobUsdc * 1e6));
  if (ctl.run.network === "mainnet" && Number(ctl.run.cap) / 1e6 > MAINNET_MAX_JOB_USD + 1e-9)
    throw new Error(`This job would hold ${fmt(ctl.run.cap)} USDC of real money, over the $${MAINNET_MAX_JOB_USD} limit for a mainnet job on this server. Make it smaller.`);
  if (BigInt(ctl.run.cap) > jobMax) throw new Error(`This job would hold ${fmt(ctl.run.cap)} USDC, over your ${limits().maxJobUsdc} USDC per-job limit. Trim the paid lookups or raise the limit in Settings.`);
  // Limits can change after a move was checked: the order is held to today's limit, not the one it was built under.
  const order = ctl.run.proposal?.action ? maxCost(ctl.run.proposal.action) : 0;
  if (order > limits().maxOrderUsd + 1e-9) throw new Error(`This order could cost $${order.toFixed(2)}, over your $${limits().maxOrderUsd} per-order limit. Make it smaller or raise the limit in Settings.`);
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

// ---------- a cap on jobs running at once ----------

/** Jobs share one agent wallet, one exchange key and one AI quota; past this many, new ones wait their turn. */
const MAX_ACTIVE = Number(process.env.MAX_ACTIVE_JOBS ?? 8);
const slots = ((globalThis as unknown as { __agentoSlots?: { active: number; queue: (() => void)[] } }).__agentoSlots ??= { active: 0, queue: [] });

async function takeSlot(ctl: Ctl) {
  if (slots.active < MAX_ACTIVE) {
    slots.active++;
    return;
  }
  log(ctl, { kind: "failure", what: "Waiting for a free slot", why: `${slots.active} jobs are running; this one starts when one finishes (${slots.queue.length + 1} in line)`, outcome: "retried", by: "system" });
  await new Promise<void>((r) => slots.queue.push(r));
}
function freeSlot() {
  const next = slots.queue.shift();
  if (next) next();
  else slots.active = Math.max(0, slots.active - 1);
}

async function execute(ctl: Ctl) {
  await takeSlot(ctl);
  try {
    await executeNow(ctl);
  } finally {
    freeSlot();
  }
}

/** Runs inside the job's network, so lookups and purchases deep below follow it. */
function executeNow(ctl: Ctl) {
  return withNet(ctl.run.network, () => executeNowInNet(ctl));
}

async function executeNowInNet(ctl: Ctl) {
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
    emit(ctl, { type: "phase.started", phaseId, at: now() });
    const chargedBefore = phaseCharged(ctl, phaseId);
    try {
      await agent.runPhase(phaseId, agentCtx(ctl, phaseId));
      emit(ctl, { type: "phase.done", phaseId, at: now() });
      return;
    } catch (e) {
      if (e instanceof Cancelled || ctl.cancelled) throw new Cancelled();
      const phase = ctl.run.phases.find((p) => p.id === phaseId)!;
      // Not needed after all: nothing was paid, and its approved money stays in the vault until close.
      if (e instanceof SkipPhase) {
        releaseLine(ctl, phase);
        emit(ctl, { type: "phase.skipped", phaseId, note: e.message, at: now() });
        tallyRun(ctl);
        return;
      }
      // An earlier step didn't give what this one needs: the failure stays local, nothing is paid.
      if (e instanceof PhaseFailure && e.code === "missing_input" && phase.optional) {
        releaseLine(ctl, phase);
        log(ctl, { kind: "failure", phaseId, what: `${phase.label}: couldn't run`, why: e.message, outcome: "skipped", by: "system" });
        emit(ctl, { type: "phase.skipped", phaseId, note: e.message, at: now() });
        tallyRun(ctl);
        return;
      }
      const code: FailureCode = e instanceof PaymentError || e instanceof PhaseFailure ? e.code : "unknown";
      const retryable = !(e instanceof PhaseFailure && e.code === "unknown");
      const failure: Failure = {
        id: id(),
        phaseId,
        code,
        message: ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).split("\n")[0].slice(0, 160),
        charged: (phaseCharged(ctl, phaseId) - chargedBefore).toString(),
        notCharged: ctl.run.phases.find((p) => p.id === phaseId)?.payments.find((p) => p.txState === "failed" && !p.maybeCharged)?.amount ?? "0",
        refunded: e instanceof PhaseFailure ? e.refunded : undefined,
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
          ctl.funded = BigInt(await chainOf(ctl.run.network).publicClient.readContract({ address: ctl.run.vault!, abi: vaultAbi, functionName: "funded" }));
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

/** Recomputes the live verdict tally when a job has findings to count. */
function tallyRun(ctl: Ctl) {
  if (!ctl.run.phases.some((p) => p.finding) && !ctl.run.lanes) return;
  const v = tally(ctl.run);
  const was = ctl.run.verdict;
  if (was && was.lean === v.lean && was.good === v.good && was.warn === v.warn && was.bad === v.bad && was.pending === v.pending) return;
  emit(ctl, { type: "run.tallied", verdict: v });
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
    buyMarketplace: (lineId, key, product, fetcher, check) => buyMarketplace(ctl, phaseId, lineId, key, product, fetcher, check),
    results: () => ctl.run.results ?? {},
    skip: (note) => {
      throw new SkipPhase(note);
    },
    update: (pid, patch) => {
      emit(ctl, { type: "phase.updated", phaseId: pid, patch });
      if (patch.finding) tallyRun(ctl);
    },
    decide: (what, why) => log(ctl, { kind: "card_edit", phaseId, what, why, outcome: "approved", by: "system" }),
  };
}

async function buy<T>(ctl: Ctl, phaseId: string, lineId: string, product: string, params: Record<string, string>, key: string): Promise<T> {
  if (ctl.cache.has(key)) return ctl.cache.get(key) as T;
  if (ctl.cancelled) throw new Cancelled();
  const adapter = adapterFor(ctl.run);
  const sellerId = "primary" as const;
  const fault = takeFault(ctl, phaseId);
  const req = { product, params, seller: sellerId, fault: fault === "approval_timeout" ? "price_increase" : fault, net: ctl.run.network };

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
  // An attempt whose answer failed the delivery check keeps its own entry, so the receipt shows it and its refund.
  const missed = ctl.run.phases.find((p) => p.id === phaseId)?.payments.filter((p) => (p.id === key || p.id.startsWith(`${key}#`)) && p.refund).length ?? 0;
  const payment: Payment = { id: missed ? `${key}#${missed + 1}` : key, lineId, txState: "planned", amount: amount.toString() };
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
    // Did it arrive? Only an answer that passes the seller's own published checks is used.
    const verdict = checkDelivery(data, PRODUCTS[product]?.promise, params);
    if (!verdict.ok) {
      payment.delivery = { test: verdict.test, reason: verdict.reason };
      throw await settleBadDelivery(ctl, lineId, product, quote.payTo, data, result.amount, result.txHash, verdict, update);
    }
    recordDelivery({ vendor: quote.payTo, ok: true, evidence: result.txHash });
    ctl.cache.set(key, data);
    emit(ctl, { type: "data.received", key, product, data, phaseId });
    return data as T;
  } catch (e) {
    if (!(e instanceof PhaseFailure && e.code === "bad_delivery")) update({ txState: "failed" });
    throw e;
  }
}

/**
 * A paid answer that failed a published check. If the answer came back, the claim goes to the
 * seller with the answer as evidence and the price comes back to the vault; the seller gets a strike.
 * If nothing came back at all (lost on the way and couldn't be sent again), nobody is blamed: no
 * strike, no claim, and the job says so.
 */
async function settleBadDelivery(
  ctl: Ctl,
  lineId: string,
  product: string,
  payee: Hex,
  answer: unknown,
  amount: bigint,
  txHash: Hex | undefined,
  verdict: Extract<DeliveryVerdict, { ok: false }>,
  update: (p: Partial<Payment>) => void,
): Promise<PhaseFailure> {
  const seller = Object.values(SELLERS).find((s) => s.address.toLowerCase() === payee.toLowerCase())?.name ?? "The seller";
  if (verdict.test === "answered") {
    update({ refund: { state: "unknown", amount: amount.toString(), note: "Paid, but the answer was lost and couldn't be sent again" } });
    log(ctl, { kind: "failure", what: `${PRODUCTS[product]?.description ?? product}: paid, answer lost`, why: verdict.reason, outcome: "rejected", by: "system", tx: txHash });
    return new PhaseFailure("bad_delivery", `Paid, but the answer was lost on the way and couldn't be fetched again. Trying again pays again.`);
  }
  recordDelivery({ vendor: payee, ok: false, reason: `${verdict.test}: ${verdict.reason}`, evidence: txHash });
  const r = await adapterFor(ctl.run)
    .refund(ctl.run, { product, amount, txHash, answer })
    .catch((e: Error) => ({ refused: e.message }));
  if ("refused" in r) {
    update({ refund: { state: "unknown", amount: amount.toString(), note: `Refund refused: ${r.refused}`.slice(0, 160) } });
    log(ctl, { kind: "failure", what: `${seller} didn't deliver`, why: `${verdict.reason}; refund refused: ${r.refused}`, outcome: "rejected", by: "system", tx: txHash });
    return new PhaseFailure("bad_delivery", `${seller} sent an answer that failed the check (${verdict.reason.toLowerCase()}) and didn't refund it.`);
  }
  const fresh = ctl.run.lines.find((l) => l.id === lineId)!;
  const net = BigInt(fresh.actual) - r.amount;
  emit(ctl, { type: "line.updated", line: { ...fresh, actual: (net < 0n ? 0n : net).toString() } });
  update({ refund: { state: "refunded", amount: r.amount.toString(), txHash: r.txHash } });
  log(ctl, { kind: "failure", what: `${seller} didn't deliver; refunded`, why: verdict.reason, amount: r.amount.toString(), outcome: "rejected", by: "system", tx: r.txHash });
  return new PhaseFailure("bad_delivery", `${seller} sent an answer that failed the check (${verdict.reason.toLowerCase()}). Your ${fmt(r.amount.toString())} USDC was sent back.`, r.amount.toString());
}

/**
 * Buys from a Circle Agent Marketplace seller with a Gateway nanopayment. Same rules as vault
 * spends: an approved line, its payee, its price. Paid from the agent's Gateway balance.
 */
async function buyMarketplace<T>(
  ctl: Ctl,
  phaseId: string,
  lineId: string,
  key: string,
  product: string,
  fetcher: () => Promise<T & { paid: { amountUsdc: number; payTo: string; via: string } }>,
  check: { promise?: DeliveryPromise; asked?: Record<string, string>; resource?: string } = {},
): Promise<T> {
  if (ctl.cache.has(key)) return ctl.cache.get(key) as T;
  if (ctl.cancelled) throw new Cancelled();
  const line = ctl.run.lines.find((l) => l.id === lineId);
  if (!line) throw new PhaseFailure("policy_block", "No approved line for this purchase");
  // A seller that failed two deliveries in the last day is paused, with the reason, before anything is paid.
  const st = standing(line.payee);
  if (st.skipped) throw new PhaseFailure("policy_block", `${line.payeeName} is paused after ${st.failures.length} failed deliveries today (until ${new Date(st.until!).toUTCString().slice(17, 22)} UTC)`);
  const unit = BigInt(line.calls?.unitPrice ?? line.approved);
  const verdict = checkSpend(ctl.run, { lineId, payee: line.payee, amount: unit });
  if (!verdict.ok) throw new PhaseFailure("policy_block", verdict.detail);
  await ensureGatewayFunds().catch((e) => {
    throw e instanceof GatewayFundsError ? new PaymentError("payment_rejected", e.message) : e;
  });
  const missed = ctl.run.phases.find((p) => p.id === phaseId)?.payments.filter((p) => (p.id === key || p.id.startsWith(`${key}#`)) && p.refund).length ?? 0;
  const payment: Payment = { id: missed ? `${key}#${missed + 1}` : key, lineId, txState: "signing", amount: unit.toString(), via: "Circle Gateway nanopayment" };
  emit(ctl, { type: "payment.updated", phaseId, payment: { ...payment, at: now() } });
  try {
    const got = await fetcher();
    const paid = BigInt(Math.round(got.paid.amountUsdc * 1e6));
    // The seller's price must match what was approved; anything else is refused, never paid silently.
    if (paid > unit || got.paid.payTo.toLowerCase() !== line.payee.toLowerCase()) throw new PhaseFailure("policy_block", "Seller's price or payee changed");
    const verdict = checkDelivery(got, check.promise, check.asked);
    if (!verdict.ok) throw new DeliveryError(verdict, got);
    recordDelivery({ vendor: line.payee, ok: true });
    if (check.resource) recordOutcome(check.resource, true);
    const fresh = ctl.run.lines.find((l) => l.id === lineId)!;
    emit(ctl, { type: "line.updated", line: { ...fresh, actual: (BigInt(fresh.actual) + paid).toString() } });
    emit(ctl, { type: "payment.updated", phaseId, payment: { ...payment, txState: "settled", amount: paid.toString(), at: now() } });
    ctl.cache.set(key, got);
    emit(ctl, { type: "data.received", key, product, data: got, phaseId });
    return got;
  } catch (e) {
    if (e instanceof DeliveryError) {
      // An outside seller was paid from the app's own Gateway balance and its answer failed a check.
      // It can't be made to refund, so the app absorbs it: you aren't charged, and the seller gets a strike.
      recordDelivery({ vendor: line.payee, ok: false, reason: `${e.verdict.test}: ${e.verdict.reason}` });
      if (check.resource) recordOutcome(check.resource, false);
      const refund = { state: "absorbed" as const, amount: unit.toString(), note: "An outside seller that doesn't refund; the app covered it, you weren't charged" };
      emit(ctl, { type: "payment.updated", phaseId, payment: { ...payment, txState: "settled", delivery: { test: e.verdict.test, reason: e.verdict.reason }, refund, at: now() } });
      log(ctl, { kind: "failure", what: `${line.payeeName} didn't deliver`, why: e.verdict.reason, amount: unit.toString(), outcome: "rejected", by: "system" });
      throw new PhaseFailure("bad_delivery", `${line.payeeName} sent an answer that failed the check (${e.verdict.reason.toLowerCase()}). You weren't charged for it.`);
    }
    const maybe = e instanceof MaybeChargedError;
    emit(ctl, { type: "payment.updated", phaseId, payment: { ...payment, txState: "failed", maybeCharged: maybe || undefined, at: now() } });
    if (e instanceof PhaseFailure) throw e;
    if (maybe) throw new PaymentError("settle_fails", `${(e as Error).message.slice(0, 120)}. It may still be charged to the app's balance, not to you.`);
    throw new PaymentError("payment_rejected", `Marketplace purchase failed: ${(e as Error).message.slice(0, 140)}`);
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
    const { publicClient } = chainOf(ctl.run.network);
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
  return { network: ctl.run.network ?? "testnet", vault: ctl.run.vault, usdc: chainOf(ctl.run.network).usdc, planRoot: c.root, topUp: c.shortfall.toString(), approvedAmount: c.approvedAmount.toString() };
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
  if (ctl.run.plan?.status === "running") await stopPlan(runId);
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
    if (run.status === "running") void resume(ctl).catch((e) => (console.warn(`resume ${run.id}:`, (e as Error).message), recover(ctl)));
    if (run.status === "funding") void resumeFunding(ctl).catch((e) => (console.warn(`resume funding ${run.id}:`, (e as Error).message), recover(ctl)));
  }
  // After every job is back: plans that were under way take their next step.
  for (const ctl of runs.values()) if (ctl.run.plan?.status === "running") void advancePlan(ctl.run.id);
}

/** Picks a running job up where it stopped: finished steps stay finished, bought data is reused. */
async function resume(ctl: Ctl) {
  const agent = AGENTS[ctl.run.agent];
  ctl.memory = agent.restore?.(ctl.options, ctl.run) ?? {};
  for (const [k, v] of Object.entries(ctl.run.feed ?? {})) ctl.cache.set(k, v.data);
  adapterFor(ctl.run).restore?.(ctl.run, ctl.funded, sum(ctl.run.lines.filter((l) => !offVault(l.rail)).map((l) => l.actual)));
  emit(ctl, { type: "run.resumed", at: now() });
  log(ctl, { kind: "failure", what: "Server restarted", why: "Picked up where it left off; finished steps and bought data were kept", outcome: "retried", by: "system" });
  await execute(ctl);
}

/** A job cut off while its vault was being funded: carry on if the vault exists onchain, otherwise back to draft. */
async function resumeFunding(ctl: Ctl) {
  const hash = planHash(ctl.run);
  const { factory: FACTORY, publicClient } = chainOf(ctl.run.network);
  if (ctl.run.mode === "live" && FACTORY) {
    const vault = await publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "vaultFor", args: [ctl.run.client, hash] });
    const funded = vault && vault !== "0x0000000000000000000000000000000000000000" ? BigInt(await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "funded" }).catch(() => 0n)) : 0n;
    if (funded >= BigInt(ctl.run.cap) && funded > 0n) {
      ctl.funded = funded;
      emit(ctl, { type: "run.approved", planHash: hash, vault, at: now() });
      log(ctl, { kind: "plan_approval", what: "Vault found onchain after a restart", why: "Funding had gone through; the job carries on", outcome: "approved", by: "system" });
      return resume(ctl);
    }
  }
  emit(ctl, { type: "workorder.updated", run: { ...ctl.run, status: "draft", editNote: { ok: false, message: "Funding was interrupted by a restart and nothing was charged. Approve again when you're ready." } } });
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

/** Keeps resting orders current while nobody is looking: fills, partial fills, cancels on the exchange. */
function trackOpenOrders() {
  const gg = globalThis as unknown as { __agentoOrderPoll?: ReturnType<typeof setInterval> };
  if (gg.__agentoOrderPoll) return;
  const every = Number(process.env.ORDER_POLL_MS ?? 60_000);
  gg.__agentoOrderPoll = setInterval(() => {
    for (const ctl of runs.values()) {
      if (dueToSettle(ctl.run)) void settleRun(ctl.run.id).catch((e) => console.warn(`settle ${ctl.run.id}:`, (e as Error).message));
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

/** A bought position whose market has closed and whose result isn't on record yet. */
function dueToSettle(run: Run) {
  const a = run.proposal?.action;
  if (run.status !== "done" || run.settlement || !run.order || a?.kind !== "prediction_order" || a.trade === "sell") return false;
  if (!["filled", "simulated", "open", "cancelled"].includes(run.order.status)) return false;
  const closes = a.combo ? Math.min(...a.combo.legs.map((l) => (l.expiry ? Date.parse(l.expiry) : Infinity))) : run.proposal?.market?.closesAt ? Date.parse(run.proposal.market.closesAt) : NaN;
  return Number.isFinite(closes) && closes <= Date.now();
}

/** Reads how the job's market resolved and records what the position paid. Safe to call any time. */
export async function settleRun(runId: string) {
  const ctl = ctlOf(runId);
  const a = ctl.run.proposal?.action;
  if (!dueToSettle(ctl.run) || a?.kind !== "prediction_order") return ctl.run;
  const base = marketBase(ctl.run.order!.venue);
  const tickers = [...new Set(a.combo ? a.combo.legs.map((l) => l.eventTicker) : [a.eventTicker])];
  const events = await Promise.all(tickers.map((t) => gemini.getEvent(t, base).catch(() => null)));
  const resolved = new Map(events.flatMap((e) => (e?.contracts ?? []).map((c) => [c.symbol, c.resolved] as const)));
  const s = settle(a, ctl.run.order, (symbol) => resolved.get(symbol));
  if (!s || ctl.run.settlement) return ctl.run;
  emit(ctl, { type: "order.settled", settlement: s });
  log(ctl, { kind: "failure", what: s.won ? `Resolved your way: ${s.practice ? "would have paid" : "paid"} $${s.paid.toFixed(2)}` : "Resolved the other way: no payout", why: `${s.quantity} contract${s.quantity === 1 ? "" : "s"} for $${s.cost.toFixed(2)}; the market settled ${s.resolved.toUpperCase()}`, outcome: "approved", by: "system" });
  recordSettlement(ctl.run, s);
  return ctl.run;
}

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

// ---------- plans: several moves in a row, each run as its own job ----------

const planLocks = new Map<string, Promise<void>>();

/** The user started a plan from the chat: each step becomes a job, run one after another. */
export async function startPlan(runId: string, planId: string) {
  const ctl = ctlOf(runId);
  if (ctl.run.status !== "exploring") throw new Error("go back to the chat to start a plan");
  if (ctl.run.plan?.status === "running") throw new Error("a plan is already running here");
  if (ctl.run.payer === "passkey") throw new Error("Plans approve each step for you, which needs the server wallet; with a passkey wallet, run the steps one at a time");
  // The plan as the user last left it on the board, or as first proposed.
  const proposed = ctl.run.plan?.id === planId && ctl.run.plan.status === "proposed" ? ctl.run.plan : [...(ctl.run.chat ?? [])].reverse().find((m) => m.plan?.id === planId)?.plan;
  if (!proposed) throw new Error("plan not found");
  // One click approves every step in turn, so the whole plan is held to a ceiling first.
  const most = proposed.steps.reduce((a, s) => a + s.proposal.research.reduce((x, r) => x + lookupCost(r), 0) + maxCost(s.proposal.action), 0);
  if (most > limits().maxPlanUsd + 1e-9) throw new Error(`This plan could cost up to $${most.toFixed(2)} in total, over your $${limits().maxPlanUsd} plan limit. Drop a step or raise the limit in Settings.`);
  const plan: Plan = { ...proposed, status: "running", steps: proposed.steps.map((s) => ({ ...s, status: "waiting", runId: undefined, note: undefined, parts: undefined })) };
  emit(ctl, { type: "plan.updated", plan });
  log(ctl, { kind: "plan_approval", what: `Plan started: ${plan.title}`, why: `${plan.steps.length} steps, each approved for you when its turn comes, within the limits shown`, outcome: "approved", by: "user" });
  emit(ctl, { type: "chat.message", message: { id: id(), role: "agent", text: (() => {
    const first = plan.steps.filter((x) => !(x.after ?? []).length);
    return first.length > 1 ? `Started ${first.length} steps at once: ${first.map((x) => x.proposal.title).join("; ")}. The rest follow as these finish.` : `Started. Step 1: ${plan.steps[0].proposal.title}. I'll move to the next step as each one finishes.`;
  })(), at: now() } });
  void advancePlan(runId);
  return ctl.run;
}

/**
 * An empty project the user fills by hand: a conversation with no agent reply yet and an empty
 * board. Jobs are added on the board ("Add a job") or by asking in the chat.
 */
export async function createProject(title: string, mode?: "demo" | "live") {
  const name = title.trim().slice(0, 80) || "New project";
  const run = await createRun({ agent: "inso", task: name, mode }, { quiet: true });
  const plan: Plan = { id: id(), title: name, why: "Jobs you add here run together, each with its own page and receipt.", steps: [], unavailable: [], status: "proposed" };
  return offerPlan(run.id, plan, "Your project is ready. Add a job on the board, or tell me what it's for and I'll suggest the jobs.");
}

/** Puts a ready-made plan in front of the user as an agent message (used by outside AIs and tests). */
export function offerPlan(runId: string, plan: Plan, text = plan.why) {
  const ctl = ctlOf(runId);
  if (ctl.run.status !== "exploring") throw new Error("a plan can only be offered while chatting");
  emit(ctl, { type: "chat.message", message: { id: id(), role: "agent", text, at: now(), plan: { ...plan, status: "proposed" }, suggestions: ["Yes, start the plan", "Not now"] } });
  return ctl.run;
}

/** The plan the user is looking at: edited on the board, or the latest one proposed in chat. */
function currentPlan(ctl: Ctl): Plan | undefined {
  const latest = [...(ctl.run.chat ?? [])].reverse().find((m) => m.plan)?.plan;
  return ctl.run.plan && (!latest || ctl.run.plan.id === latest.id) ? ctl.run.plan : latest;
}

const planBusy = new Set<string>();

/** One edit to a plan that hasn't started: add, change, remove or rewire a step. */
export async function editPlanOf(runId: string, op: PlanOp | { op: "add"; agent: "auto" | AgentId; brief: string; after?: string[] }) {
  const ctl = ctlOf(runId);
  const plan = currentPlan(ctl);
  if (!plan) throw new Error("there is no plan to change");
  if (ctl.run.status !== "exploring" || plan.status !== "proposed") throw new Error("a plan can only be changed before it starts");
  if (planBusy.has(runId)) throw new Error("the plan is still being changed");
  planBusy.add(runId);
  try {
    const real: PlanOp = op.op === "add" ? { ...op, agent: op.agent === "auto" ? await routeAgent(op.brief) : op.agent } : op;
    const r = await editPlan(plan, real, async (agent, brief, id) => {
      const built = await buildPlanStep(agent, brief, id);
      if ("usage" in built) for (const u of built.usage) trackAi(ctl, "plan", u);
      return built;
    });
    if ("error" in r) throw new Error(r.error);
    emit(ctl, { type: "plan.updated", plan: r.plan });
    return ctl.run;
  } finally {
    planBusy.delete(runId);
  }
}

/**
 * Gives a step that didn't go through another try. The steps that were skipped because of it
 * get their turn back too.
 */
export async function retryPlanStep(runId: string, stepId: string) {
  const ctl = ctlOf(runId);
  const plan = ctl.run.plan;
  if (!plan || plan.status === "proposed") throw new Error("the plan hasn't started");
  const target = plan.steps.find((s) => s.id === stepId);
  if (!target || (target.status !== "failed" && target.status !== "skipped")) throw new Error("only a step that didn't go through can be retried");
  const fresh = (s: PlanStep): PlanStep => ({ ...s, status: "waiting", runId: undefined, note: undefined, parts: undefined });
  const steps = plan.steps.map((s) => (s.id === stepId ? fresh(s) : s));
  // Anything downstream that was skipped is waiting again; it only runs if what it needs now succeeds.
  for (let changed = true; changed; ) {
    changed = false;
    steps.forEach((s, i) => {
      if (s.status === "skipped" && s.after.some((a) => steps.find((x) => x.id === a)?.status === "waiting")) {
        steps[i] = fresh(s);
        changed = true;
      }
    });
  }
  emit(ctl, { type: "plan.updated", plan: { ...plan, status: "running", steps } });
  log(ctl, { kind: "failure", what: `Step ${stepId.slice(1)} of the plan retried`, why: target.note ?? "It didn't go through the first time", outcome: "retried", by: "user" });
  void advancePlan(runId);
  return ctl.run;
}

/** Stops a plan: the running step is cancelled (returning its unspent funds), the rest won't start. */
export async function stopPlan(runId: string) {
  const ctl = ctlOf(runId);
  const plan = ctl.run.plan;
  if (!plan || plan.status !== "running") return ctl.run;
  const running = plan.steps.filter((s) => s.status === "running" && s.runId && runs.has(s.runId));
  emit(ctl, { type: "plan.updated", plan: { ...plan, status: "stopped", steps: plan.steps.map((s) => (s.status === "waiting" || s.status === "blocked" ? { ...s, status: "skipped", note: "Plan stopped" } : s)) } });
  await Promise.all(running.map((s) => cancel(s.runId!).catch(() => undefined)));
  log(ctl, { kind: "failure", what: "Plan stopped", why: "Stopped by you; steps not started won't run", outcome: "cancelled", by: "user" });
  return ctl.run;
}

/** One step at a time per plan, however many child events arrive at once. */
function advancePlan(parentId: string): Promise<void> {
  const prev = planLocks.get(parentId) ?? Promise.resolve();
  const next = prev.then(() => advanceNow(parentId)).catch((e) => console.warn(`plan ${parentId}:`, (e as Error).message));
  planLocks.set(parentId, next);
  return next;
}

/** What a finished sell brought in, in dollars: fills at their average price; a practice order at its limit. */
function proceedsOf(run: Run): number {
  const o = run.order;
  const a = run.proposal?.action;
  if (!o || !a) return 0;
  if (o.status === "simulated") return a.kind === "prediction_order" ? a.maxPrice * a.quantity : a.kind === "spot_order" ? a.amountUsd : 0;
  const filled = o.filledQuantity ?? 0;
  const price = o.avgPrice ?? (a.kind === "prediction_order" ? a.maxPrice : a.kind === "spot_order" ? a.limitPrice : 0);
  return filled * price;
}

const ended = (s: PlanStep) => s.status === "done" || s.status === "skipped" || s.status === "failed";

/**
 * Moves a plan forward as far as it can go right now. Steps form a graph: each starts when the
 * steps it waits for are done (or their orders filled), independent steps run at the same time,
 * and a step that fails only takes the steps that depended on it down with it.
 */
async function advanceNow(parentId: string) {
  const ctl = runs.get(parentId);
  const plan = ctl?.run.plan;
  if (!ctl || !plan || plan.status !== "running") return;
  const steps: PlanStep[] = plan.steps.map((s) => ({ ...s, after: s.after ?? [] }));
  const before = JSON.stringify(plan.steps);
  const save = () => emit(ctl, { type: "plan.updated", plan: { ...plan, steps: steps.map((s) => ({ ...s })) } });
  const num = (id: string) => id.replace(/^s/, "");

  // 1. Steps under way: read where their job stands.
  for (const s of steps) {
    if (s.status !== "running") continue;
    const child = s.runId ? runs.get(s.runId)?.run : undefined;
    if (child) s.parts = partsProgress(child);
    if (!child) Object.assign(s, { status: "failed", note: "Its job was lost" });
    else if (child.status === "done") {
      const o = child.order;
      s.status = "done";
      // What the step actually found, in its own figures: the lookups' readings, or the order's state.
      const read = child.phases.filter((p) => p.lineId && p.lineId !== "order" && p.note && p.note !== p.label).map((p) => p.note);
      const ordered = o ? (o.status === "filled" ? "Filled" : o.status === "open" ? "Order placed, waiting to fill" : o.status === "simulated" ? `Practice order: ${o.detail.replace(/^Practice only: /, "")}` : o.status === "skipped" ? o.detail : o.status[0].toUpperCase() + o.status.slice(1)) : "";
      s.note = ([ordered, ...(ordered ? [] : read)].filter(Boolean).join(" · ") || child.deliverable?.summary || "Done").slice(0, 240);
    } else if (child.status === "cancelled") Object.assign(s, { status: "failed", note: "Cancelled" });
    else s.note = child.pendingFailures.length + child.pendingReapprovals.length ? "Needs you: open the step" : child.status === "draft" ? "Waiting for approval" : "Running";
  }

  // 2. Steps not started: start the ones whose turn has come.
  for (const s of steps) {
    if (s.status !== "waiting" && s.status !== "blocked") continue;
    const deps = s.after.map((id) => steps.find((x) => x.id === id)!).filter(Boolean);
    const broken = deps.find((d) => d.status === "failed" || d.status === "skipped");
    if (broken) {
      Object.assign(s, { status: "skipped", note: `Step ${num(broken.id)} didn't go through, and this one depended on it` });
      continue;
    }
    if (deps.some((d) => d.status !== "done")) continue;
    let budget: number | undefined;
    if (s.gate === "filled") {
      // Only the steps that placed an order have a fill to wait for; lookups and routes just had to finish.
      const orders = deps.filter((d) => d.proposal.action && d.proposal.action.kind !== "itinerary").map((d) => ({ d, run: d.runId ? runs.get(d.runId)?.run : undefined }));
      // An order placed earlier may have filled since: look before deciding.
      await Promise.all(orders.filter((x) => x.run?.order?.status === "open").map((x) => refreshRunOrder(x.run!.id).catch(() => undefined)));
      const state = orders.map((x) => ({ d: x.d, st: x.d.runId ? runs.get(x.d.runId)?.run.order?.status : undefined }));
      const waiting = state.find((x) => x.st === "open");
      if (waiting) {
        Object.assign(s, { status: "blocked", note: `Waiting for step ${num(waiting.d.id)}'s order to fill` });
        continue;
      }
      // An order closed after selling only part still brought something in: carry on with that part.
      const partly = (x: { d: PlanStep }) => {
        const o = x.d.runId ? runs.get(x.d.runId)?.run.order : undefined;
        return o?.status === "cancelled" && (o.filledQuantity ?? 0) > 0;
      };
      const dead = state.find((x) => x.st !== "filled" && x.st !== "simulated" && !partly(x));
      if (dead) {
        Object.assign(s, { status: "skipped", note: `Step ${num(dead.d.id)}'s order ${dead.st ? `was ${dead.st}` : "wasn't placed"}, so this doesn't run` });
        continue;
      }
      // Whole cents, rounded down; the small nudge keeps 4 × 0.58 from landing on 2.3199….
      if (s.useProceeds) budget = Math.floor(orders.reduce((sum, x) => sum + (x.run ? proceedsOf(x.run) : 0), 0) * 100 + 1e-6) / 100;
    }
    try {
      let proposal = s.proposal;
      // Spending what an earlier step brought in: the move is re-checked with that as its budget.
      if (budget != null) {
        if (budget <= 0) throw new Error("The sell it waits for brought in nothing to spend");
        // "Use the money" means spend it: the order is sized to the proceeds (within your order limit), not left at its first draft.
        const draft = toProposalInput(s.proposal);
        const spend = Math.min(budget, limits().maxOrderUsd);
        const a = draft.action;
        if (a?.kind === "prediction_order" && a.trade !== "sell" && !draft.hedge) a.quantity = Math.min(500, Math.max(1, Math.floor(spend / a.maxPrice + 1e-9)));
        if (a?.kind === "spot_order" && a.side === "buy") a.amountUsd = Math.min(100, Math.max(1, Math.floor(spend * 100) / 100));
        const v = await validateProposal(s.agent, { ...draft, budgetUsd: budget }, s.proposal.id);
        if ("error" in v) throw new Error(v.error.split(". ")[0]);
        proposal = v.proposal;
        s.proposal = proposal;
      }
      // Depending on what earlier steps found: its own agent builds it again with those findings in hand.
      // What you approved was a ceiling, so a rebuilt step that would cost more is not used.
      let rebuilt = "";
      if (budget == null && s.usesFindings && deps.length && s.brief) {
        const found = deps.map((d) => `${d.proposal.title}: ${d.note ?? "done"}`).join("; ").slice(0, 700);
        const built = await buildPlanStep(s.agent, `${s.brief}\nWhat the earlier steps found: ${found}`, s.proposal.id).catch(() => null);
        const top = (p: Proposal) => p.research.reduce((x, r) => x + lookupCost(r), 0) + maxCost(p.action);
        if (built && "proposal" in built && top(built.proposal) <= top(s.proposal) + 1e-9) {
          proposal = built.proposal;
          s.proposal = proposal;
          rebuilt = "Built from what the earlier steps found";
        } else rebuilt = built && "proposal" in built ? "Kept as first planned: the version built from the findings would cost more than you approved" : "Kept as first planned";
      }
      const child = await createRun({ agent: s.agent, task: proposal.title, mode: ctl.run.mode, network: ctl.run.network, proposal, plannedBy: `plan in job ${parentId}` } as CreateInput);
      const cc = ctlOf(child.id);
      // The agents before this one pass along what they did, so this step starts with the full picture.
      const handoff = [rebuilt, ...deps.map((d) => `${AGENTS[d.agent].name}: ${d.proposal.title} → ${d.note ?? "done"}`), budget != null ? `Budget for this step: $${budget.toFixed(2)}, what that brought in` : ""].filter(Boolean).join(" · ");
      emit(cc, { type: "workorder.updated", run: { ...cc.run, parentId, stepId: s.id, handoff: handoff || undefined } });
      Object.assign(s, { status: "running", runId: child.id, note: "Starting" });
      save();
      await approve(child.id);
      s.note = "Running";
    } catch (e) {
      Object.assign(s, { status: "failed", note: (e as Error).message.slice(0, 140) });
    }
  }
  // A step skipped in this pass may be what a later one was waiting for: one more look settles the chain.
  for (const s of steps) {
    if (s.status !== "waiting" && s.status !== "blocked") continue;
    const broken = s.after.map((id) => steps.find((x) => x.id === id)).find((d) => d && (d.status === "failed" || d.status === "skipped"));
    if (broken) Object.assign(s, { status: "skipped", note: `Step ${num(broken.id)} didn't go through, and this one depended on it` });
  }

  if (steps.every(ended)) {
    const done = steps.filter((s) => s.status === "done").length;
    emit(ctl, { type: "plan.updated", plan: { ...plan, status: "done", steps } });
    emit(ctl, {
      type: "chat.message",
      message: { id: id(), role: "agent", text: done === steps.length ? `All ${steps.length} steps are done.\n${steps.map((x) => `${x.id.slice(1)}. ${x.proposal.title}: ${x.note ?? "done"}`).join("\n")}` : `Plan finished: ${done} of ${steps.length} steps done. ${steps.filter((s) => s.status !== "done").map((s) => `${s.proposal.title}: ${s.note ?? s.status}`).join(" · ")}`, at: now() },
    });
    return;
  }
  if (JSON.stringify(steps) !== before) save();
}

// ---------- saved jobs and repeats ----------

/** Star a job so it's easy to find and run again. */
export function saveRun(runId: string, saved: boolean) {
  const ctl = ctlOf(runId);
  emit(ctl, { type: "run.saved", saved });
  return ctl.run;
}

/**
 * Runs a job again: the same move, checked against today's market and limits, as a fresh draft to approve.
 * If the move no longer works (the contract closed, the price moved past a limit), it starts a chat on the same request.
 */
export async function rerun(runId: string) {
  const src = ctlOf(runId).run;
  const base = { agent: src.agent, task: src.task, mode: src.mode };
  if (src.proposal && src.payer !== "passkey") {
    const v = await validateProposal(src.agent, toProposalInput(src.proposal), id());
    if ("proposal" in v) {
      const run = await createRun({ ...base, proposal: v.proposal, plannedBy: "a saved job" } as CreateInput);
      const cc = ctlOf(run.id);
      emit(cc, { type: "workorder.updated", run: { ...cc.run, repeatOf: src.id } });
      return { run: cc.run, fresh: true as const };
    }
    const run = await createRun(base as CreateInput, { wait: false });
    return { run, fresh: false as const, why: v.error.split(". ")[0] };
  }
  return { run: await createRun(base as CreateInput, { wait: false }), fresh: false as const };
}

// Last in the file on purpose: bringing jobs back can run them at once, and that needs everything above to exist
// (a resumed plan step reports progress to its plan as soon as it starts).
if (process.env.NEXT_PHASE !== "phase-production-build") {
  restore();
  trackOpenOrders();
}
