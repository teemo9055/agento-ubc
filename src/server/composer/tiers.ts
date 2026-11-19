import type { ComposeTrace, Proposal, ResearchStep } from "@/lib/types";
import type { IoType } from "../catalog/types";
import type { Fact, Given } from "./facts";
import type { Route, RouteStep } from "./route";

/**
 * Step C: three ways to answer, built by code from the routes.
 * - Quick: the must-know facts, cheapest route each.
 * - Thorough: must and should, best route each.
 * - Most certain: Thorough, plus a second source from another provider for each must-know fact
 *   (compared by code), and a third that is bought only if those two disagree.
 * Each becomes an ordinary proposal and still goes through the validator and the pricer.
 */
export type TierName = "quick" | "thorough" | "certain";
export const TIER_LABEL: Record<TierName, string> = { quick: "Quick", thorough: "Thorough", certain: "Most certain" };

export interface Draft {
  tier: TierName;
  /** The move as the composer wrote it: ComposedInput for the validator. */
  input: Record<string, unknown>;
  /** Facts it answers, and which of them it cross-checks. */
  answers: { id: string; question: string; crossChecked: boolean }[];
  cost: number;
  steps: number;
}

export interface Gap {
  fact: string;
  why: string;
}

const NUMERIC: IoType[] = ["price", "price_quote", "geo"];
/** Answers whose reading (fine or a concern) can be compared when there's no single field to compare. */
const TONED: IoType[] = ["risk_signal", "reviews", "identity_signal"];

/** A short subject for the title, from what the user gave. */
function subject(givens: Given[]): string {
  const t = new Set(givens.map((g) => g.type));
  if (t.has("listing_url") || t.has("image_url") || (t.has("phone") && !t.has("company_name"))) return "Check the seller";
  if (t.has("wallet_address") || t.has("tx_hash")) return "Check the wallet";
  if (t.has("domain") || t.has("company_name") || t.has("url")) return "Check the business";
  if (t.has("email")) return "Check who's behind it";
  return "Look into it";
}

const money = (x: number) => `$${x > 0 && x < 0.01 ? x.toFixed(4) : x.toFixed(2)}`;
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

interface Built {
  research: Record<string, unknown>[];
  cost: number;
}

/**
 * Turns chosen routes into research steps in run order. Two routes that start with the same service
 * fed the same way share that step. Inputs from the user go in the step's input; inputs from an
 * earlier step are bound to it, so code fills them in when it starts.
 */
function assemble(chosen: { fact: Fact; route: Route; role: "answer" | "verify" | "tie" }[], givens: Given[]): Built {
  const steps: { key: string; s: RouteStep; fact: Fact; ids: string; role: "answer" | "verify" | "tie" | "feed" }[] = [];
  const research: Record<string, unknown>[] = [];
  let cost = 0;
  const value = (name: string) => givens.find((g) => g.name === name)?.value ?? "";
  for (const { fact, route, role } of chosen) {
    const localIds: string[] = [];
    route.steps.forEach((s, i) => {
      const last = i === route.steps.length - 1;
      const input: Record<string, string> = {};
      const bind: Record<string, string> = {};
      for (const [field, f] of Object.entries(s.feeds)) {
        if (f.from === "given") input[field] = value(f.name);
        else bind[field] = `$${localIds[f.from]}${f.path ? `.${f.path}` : ""}`;
      }
      const key = `${s.capability.resource}|${JSON.stringify(input)}|${JSON.stringify(bind)}`;
      // The same service, asked the same thing, is one step (unless it is the answer being cross-checked).
      const shared = !last || role === "answer" ? steps.find((x) => x.key === key) : undefined;
      if (shared) {
        localIds.push(shared.ids);
        return;
      }
      const id = `s${steps.length + 1}`;
      localIds.push(id);
      const myRole = last ? role : "feed";
      steps.push({ key, s, fact, ids: id, role: myRole });
      cost += s.capability.priceUsd ?? 0;
      const kind = NUMERIC.includes(s.outType) ? "close" : "same";
      const what = short(last ? fact.question.replace(/\?$/, "") : `${s.capability.provider}: ${s.outType.replace(/_/g, " ")}`, 60);
      research.push({
        id,
        tool: "service",
        args: { url: s.capability.resource, input: JSON.stringify(input), what: short(s.capability.name, 60), provider: s.capability.provider, price: String(Math.round((s.capability.priceUsd ?? 0) * 1e6)), payTo: s.capability.payTo ?? "" },
        label: short(last ? (myRole === "tie" ? `Tie-breaker: ${s.capability.provider}` : `${s.capability.provider}: ${fact.question.replace(/\?$/, "")}`) : `${s.capability.provider}: find the ${s.outType.replace(/_/g, " ")}`, 60),
        why: short(last ? fact.why || what : `Feeds the next step`, 140),
        ...(Object.keys(bind).length ? { bind } : {}),
        ...(myRole === "verify" || (myRole === "answer" && chosen.some((c) => c.fact.id === fact.id && c.role === "verify")) ? { verify: { group: fact.id, path: s.outPath || "@tone", kind: s.outPath ? kind : "same", ...(kind === "close" && s.outPath ? { tolerance: 0.02 } : {}) } } : {}),
        ...(myRole === "tie" ? { onConflict: fact.id } : {}),
        resource: s.capability.resource,
        lane: fact.id,
      });
    });
  }
  return { research, cost };
}

/** Routes from different providers: the source the answer comes from must differ. */
function independent(routes: Route[]): Route[] {
  const seen = new Set<string>();
  return routes.filter((r) => {
    const p = r.steps[r.steps.length - 1].capability.provider.toLowerCase();
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });
}

export function buildTiers(facts: Fact[], routesByFact: Map<string, Route[]>, givens: Given[], trace: ComposeTrace, gapsIn: Gap[]): { drafts: Partial<Record<TierName, Draft>>; gaps: Gap[] } {
  const gaps = [...gapsIn];
  const has = (f: Fact) => (routesByFact.get(f.id)?.length ?? 0) > 0;
  const must = facts.filter((f) => f.importance === "must" && has(f));
  const should = facts.filter((f) => f.importance !== "nice" && has(f));
  // Cheapest among the good answers: within reach of the best route's score, not just any route.
  const cheapest = (f: Fact) => {
    const rs = routesByFact.get(f.id)!;
    const good = rs.filter((r) => r.score >= rs[0].score - Math.abs(rs[0].score) * 0.4);
    return [...good].sort((a, b) => a.cost - b.cost)[0];
  };
  const best = (f: Fact) => routesByFact.get(f.id)![0];

  const subj = subject(givens);
  const givenMap = Object.fromEntries(givens.map((g) => [g.name, { type: g.type, value: g.value }]));
  const gapList = gaps.map((g) => ({ fact: g.fact, why: g.why }));
  const make = (tier: TierName, chosen: { fact: Fact; route: Route; role: "answer" | "verify" | "tie" }[]): Draft | undefined => {
    if (!chosen.length) return undefined;
    const { research, cost } = assemble(chosen, givens);
    const n = research.length;
    const answered = [...new Map(chosen.map((c) => [c.fact.id, c.fact])).values()];
    const answers = answered.map((f) => ({ id: f.id, question: f.question, crossChecked: chosen.some((c) => c.fact.id === f.id && c.role === "verify") }));
    const ties = chosen.filter((c) => c.role === "tie");
    const certainCost = ties.reduce((a, c) => a + (c.route.steps[c.route.steps.length - 1].capability.priceUsd ?? 0), 0);
    return {
      tier,
      cost,
      steps: n,
      answers,
      input: {
        title: short(`${subj}: ${TIER_LABEL[tier].toLowerCase()}`, 60),
        why: short(`Answers ${answers.length} question${answers.length === 1 ? "" : "s"}: ${answers.map((a) => a.question.replace(/\?$/, "").toLowerCase()).join("; ")}`, 240),
        ask: short(`${subj} in ${n} step${n === 1 ? "" : "s"}, at most ${money(cost)}${certainCost ? ` (${money(certainCost)} only if sources disagree)` : ""}?`, 160),
        research,
        action: null,
        condition: null,
        budgetUsd: null,
        givens: givenMap,
        compose: trace,
        tier,
        gaps: gapList,
      },
    };
  };

  const drafts: Partial<Record<TierName, Draft>> = {};
  drafts.quick = make("quick", must.map((f) => ({ fact: f, route: cheapest(f), role: "answer" as const })));
  const thoroughChosen = should.map((f) => ({ fact: f, route: best(f), role: "answer" as const }));
  drafts.thorough = make("thorough", thoroughChosen);
  const extra: { fact: Fact; route: Route; role: "verify" | "tie" }[] = [];
  for (const f of must) {
    const ind = independent(routesByFact.get(f.id)!);
    if (ind.length < 2) continue;
    const first = best(f);
    const lastOf = (r: Route) => r.steps[r.steps.length - 1];
    // Comparable: a value at a known place, or how the answer reads (fine or a concern) for risk-type answers.
    const comparable = (r: Route) => Boolean(lastOf(r).outPath) || TONED.includes(lastOf(r).outType);
    if (!comparable(first)) continue;
    // A second source must answer the same kind of thing, or there is nothing to compare.
    const others = ind.filter((r) => r !== first && comparable(r) && Boolean(lastOf(r).outPath) === Boolean(lastOf(first).outPath) && lastOf(r).outType === lastOf(first).outType && lastOf(r).capability.provider !== lastOf(first).capability.provider);
    if (!others.length) continue;
    extra.push({ fact: f, route: others[0], role: "verify" });
    if (others[1]) extra.push({ fact: f, route: others[1], role: "tie" });
  }
  // The second source sits next to the first in run order; the tie-breaker comes after both.
  if (extra.length) {
    const certain: { fact: Fact; route: Route; role: "answer" | "verify" | "tie" }[] = [];
    for (const c of thoroughChosen) {
      certain.push(c);
      const v = extra.find((e) => e.fact.id === c.fact.id && e.role === "verify");
      if (v) certain.push(v);
    }
    certain.push(...extra.filter((e) => e.role === "tie"));
    drafts.certain = make("certain", certain);
  }
  // A tier that adds nothing over the one below it isn't offered.
  if (drafts.quick && drafts.thorough && drafts.quick.steps === drafts.thorough.steps && drafts.quick.cost === drafts.thorough.cost) delete drafts.quick;
  return { drafts, gaps };
}
