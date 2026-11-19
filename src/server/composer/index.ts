import type { AgentId, ChatMsg, ComposeTrace, Proposal } from "@/lib/types";
import { catalogFunnel } from "../catalog/search";
import { validateProposal } from "../tools";
import { planFromProposal } from "../agents/toolbox";
import { analyze, type Analysis, type Fact } from "./facts";
import { gapReason, newRouteCtx, routeFact, type Payable, type Route } from "./route";
import { buildTiers, TIER_LABEL, type Draft, type Gap, type TierName } from "./tiers";

/**
 * Step D: the composer. From a problem in plain words to up to three ready-to-review plans built
 * from the whole marketplace catalog, with the trace the funnel shows ("Searched 2,667 services →
 * 38 relevant → 3 plans"). Every plan is an ordinary proposal: the existing validator prices it
 * from each seller's own quote, and the user approves it like any other move.
 */
export interface TierOption {
  tier: TierName;
  label: string;
  proposal: Proposal;
  /** Can run on this job's network now; otherwise why not ("Only payable on Arc mainnet"). */
  runnable: boolean;
  why?: string;
  /** At most, in USD (every step, including ones that only run if needed). */
  cost: number;
  steps: number;
  answers: { id: string; question: string; crossChecked: boolean }[];
}

export interface Composed {
  tiers: TierOption[];
  /** The one selected by default: Thorough when there is one. */
  selected?: TierName;
  gaps: Gap[];
  trace: ComposeTrace;
  analysis: Analysis;
}

export interface ComposeOpts {
  payable: Payable;
  /** The agent whose job this becomes (its toolkit must allow marketplace steps). */
  agent?: AgentId;
  /** An id for the proposals; tiers get `${id}-quick` etc. */
  id?: string;
}

export async function compose(problem: string, chat: ChatMsg[], opts: ComposeOpts): Promise<Composed> {
  const t0 = Date.now();
  const analysis = await analyze(problem, chat);
  const ctx = newRouteCtx(opts.payable);
  const routesByFact = new Map<string, Route[]>();
  const gaps: Gap[] = [];
  for (const f of analysis.facts) {
    ctx.dropped = { price: 0, network: 0, inputs: new Set() };
    const routes = await routeFact(f, analysis.givens, ctx);
    routesByFact.set(f.id, routes);
    if (!routes.length) gaps.push({ fact: f.question, why: gapReason(ctx, 0) });
  }
  for (const o of analysis.outOfScope) gaps.push({ fact: o, why: "Needs your own account or a person, not a data service" });
  const trace: ComposeTrace = {
    searched: catalogFunnel().total,
    relevant: ctx.relevant.size,
    considered: ctx.considered,
    facts: analysis.facts.map((f: Fact) => ({ id: f.id, question: f.question, covered: (routesByFact.get(f.id)?.length ?? 0) > 0, importance: f.importance })),
    ms: 0,
  };
  const { drafts } = buildTiers(analysis.facts, routesByFact, analysis.givens, trace, gaps);
  trace.ms = Date.now() - t0;
  const base = opts.id ?? `c${Date.now().toString(36)}`;
  const tiers: TierOption[] = [];
  for (const name of ["quick", "thorough", "certain"] as const) {
    const d = drafts[name];
    if (!d) continue;
    const opt = await finish(d, `${base}-${name}`, opts, trace);
    if (opt) tiers.push(opt);
  }
  const selected = tiers.find((t) => t.tier === "thorough" && t.runnable)?.tier ?? tiers.find((t) => t.runnable)?.tier ?? tiers.find((t) => t.tier === "thorough")?.tier ?? tiers[0]?.tier;
  return { tiers, selected, gaps, trace: { ...trace, ms: Date.now() - t0 }, analysis };
}

/**
 * A tier through the existing validator: price and payee from each seller's own quote, chains
 * checked. One that can't be paid on this network is still shown, marked, so the user knows it
 * exists; anything else the validator refuses is dropped and the reason logged.
 */
async function finish(d: Draft, id: string, opts: ComposeOpts, trace: ComposeTrace): Promise<TierOption | null> {
  const input = { ...d.input, compose: trace };
  const v = await validateProposal(opts.agent ?? "worko", input, id, { composed: true });
  if ("proposal" in v) {
    const cost = planFromProposal(v.proposal).lines.reduce((a, l) => a + Number(l.approved), 0) / 1e6;
    return { tier: d.tier, label: TIER_LABEL[d.tier], proposal: v.proposal, runnable: true, cost, steps: v.proposal.research.length, answers: d.answers };
  }
  if (/isn't a marketplace service payable on this network/.test(v.error)) {
    // Shown for what it is: priced from the listings, runnable once the job is on Arc mainnet.
    const draft = draftProposal(d, id, trace);
    return { tier: d.tier, label: TIER_LABEL[d.tier], proposal: draft, runnable: false, why: "Only payable on Arc mainnet", cost: d.cost, steps: d.steps, answers: d.answers };
  }
  console.warn(`compose: ${d.tier} dropped: ${v.error}`);
  return null;
}

/** The composer's own draft, for display when the validator can't price it on this network. */
function draftProposal(d: Draft, id: string, trace: ComposeTrace): Proposal {
  const i = d.input as Record<string, unknown> & { research: Record<string, unknown>[] };
  return {
    id,
    title: String(i.title),
    why: String(i.why),
    ask: String(i.ask),
    venue: "paper",
    research: i.research.map((r) => ({ ...(r as object), id: String(r.id) }) as Proposal["research"][number]),
    givens: i.givens as Proposal["givens"],
    compose: trace,
    tier: d.tier,
    gaps: (i.gaps as Proposal["gaps"])?.length ? (i.gaps as Proposal["gaps"]) : undefined,
  };
}

/** One line per tier, for the model and for MCP. */
export function tierSummary(c: Composed) {
  return {
    funnel: `Searched ${c.trace.searched} services → ${c.trace.relevant} relevant → ${c.tiers.length} plan${c.tiers.length === 1 ? "" : "s"}`,
    tiers: c.tiers.map((t) => ({
      tier: t.label,
      proposalId: t.proposal.id,
      atMostUsd: Number(t.cost.toFixed(4)),
      steps: t.steps,
      plan: t.proposal.research.map((r) => `${r.label}${r.args.price ? ` · $${(Number(r.args.price) / 1e6).toFixed(4)}` : ""}${r.bind ? ` · uses ${Object.values(r.bind).join(", ")}` : ""}${r.verify ? " · cross-check" : ""}${r.onConflict ? " · only if sources disagree" : ""}`),
      answers: t.answers.map((a) => `${a.question}${a.crossChecked ? " (cross-checked)" : ""}`),
      runnable: t.runnable,
      ...(t.why ? { why: t.why } : {}),
    })),
    gaps: c.gaps,
    selected: c.selected,
  };
}
