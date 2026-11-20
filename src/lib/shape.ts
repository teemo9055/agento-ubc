import { chance, doesLine, getsLine } from "./plain";
import { legText, actionText, cents, conditionLabel, lookupCost, maxCost } from "./move";
import type { Proposal } from "./types";

/**
 * The shape of a piece of work, drawn in the workspace before anything runs: what it reads,
 * what it checks, what it does and what comes back. Nothing here is generated: each kind of
 * work has a fixed outline, and the blocks fill in with the real numbers as they are known.
 */
export type WorkKind = "lookup" | "order" | "conditional" | "hedge" | "trip" | "plan";
export type LaneKey = "reads" | "checks" | "does" | "gets";

export interface Block {
  label: string;
  detail?: string;
  /** In USDC or dollars, when the block can cost something. */
  cost?: number;
  /** A placeholder: the outline of something not decided yet. */
  ghost?: boolean;
}
export interface Lane {
  key: LaneKey;
  title: string;
  blocks: Block[];
}
export interface Blueprint {
  kind: WorkKind;
  lanes: Lane[];
  /** The most it can cost, once that is known. */
  costUsd?: number;
}

export const KINDS: Record<WorkKind, { name: string; line: string; example: string }> = {
  lookup: { name: "Look something up", line: "An answer from live sources, paid per request", example: "What are BTC, ETH and gold worth right now according to Chainlink?" },
  order: { name: "Place an order", line: "An order with your limit, resting until it fills", example: "Buy $5 of BTC at today's price or better" },
  conditional: { name: "Order with a condition", line: "Runs only if a fresh check passes", example: "Buy $5 of ETH, but only if Chainlink has it under $4,000" },
  hedge: { name: "Hedge a cost", line: "A small premium now, a payout if the bad thing happens", example: "I'll lose about $20 if BTC falls this month. Hedge it for a few dollars" },
  trip: { name: "Plan a trip", line: "A route split into days, with places to stay", example: "Plan a two-day drive from Dallas to San Antonio via Austin" },
  plan: { name: "Multi-step job", line: "Several jobs in order, each waiting for the ones before", example: "Check BTC with Chainlink, sell $5 of BTC, then bet the proceeds on BTC staying up" },
};

export const LANE_TITLE: Record<LaneKey, string> = { reads: "Reads", checks: "Checks", does: "Does", gets: "You get" };

const g = (label: string, detail?: string): Block => ({ label, detail, ghost: true });
const lanes = (m: Partial<Record<LaneKey, Block[]>>): Lane[] => (["reads", "checks", "does", "gets"] as const).filter((k) => m[k]?.length).map((k) => ({ key: k, title: LANE_TITLE[k], blocks: m[k]! }));

/** The empty outline of each kind of work. */
export function outline(kind: WorkKind): Blueprint {
  const m: Record<WorkKind, Partial<Record<LaneKey, Block[]>>> = {
    lookup: { reads: [g("Live data", "free"), g("A paid source", "if it helps")], gets: [g("A short answer", "with the numbers and who was paid")] },
    order: { reads: [g("The price now")], does: [g("Your order", "size and limit")], gets: [g("A fill", "or it waits at your price")] },
    conditional: { reads: [g("The price to watch")], checks: [g("Your condition", "read fresh, right before")], does: [g("Your order", "size and limit")], gets: [g("A fill", "only if the check passes")] },
    hedge: { reads: [g("The market that matches your risk")], checks: [g("The odds", "how likely it is")], does: [g("A few contracts", "the premium")], gets: [g("A payout", "if the bad thing happens")] },
    trip: { reads: [g("The driving route", "distance and hours")], does: [g("Split into days", "by hours a day")], gets: [g("Day-by-day plan", "with places to stay")] },
    plan: { reads: [g("Lookups", "side by side"), g("More lookups")], checks: [g("What must finish", "or fill, first")], does: [g("Step after step", "each its own job")], gets: [g("One summary", "and a receipt per step")] },
  };
  return { kind, lanes: lanes(m[kind]) };
}

/** A first guess at the kind of work from how the request is worded. Only picks the outline; the agent decides the rest. */
export function kindOf(text: string): WorkKind {
  const t = ` ${text.toLowerCase()} `;
  const steps = (t.match(/\b(then|after that|afterwards|and also|once (it|that)|next,)\b/g) ?? []).length;
  if (steps >= 1 && /\b(buy|sell|bet|plan|check|hedge|book)\b/.test(t)) return "plan";
  if (/\b(hedg\w*|insur\w*|protect\w*|worried|cover (me|my)|in case)\b/.test(t)) return "hedge";
  if (/\b(drive|driving|trip|route|road ?trip|itinerary|hotels?|stay)\b/.test(t)) return "trip";
  if (/\b(buy|sell|bet|order|long|short|contracts?)\b/.test(t)) return /\b(if|when|only|unless|drops?|dips?|falls?|rises?|above|below|under|over)\b/.test(t) ? "conditional" : "order";
  return "lookup";
}

const money = (x: number) => `$${x < 0.01 && x > 0 ? x.toFixed(4) : x.toFixed(2)}`;

/** The same outline, filled in from a move the agent proposed. */
export function blueprintOf(p: Proposal): Blueprint {
  const a = p.action;
  const checks = [p.condition, ...(p.also ?? [])].filter((c): c is NonNullable<typeof c> => Boolean(c));
  const kind: WorkKind = p.hedge || (a?.kind === "prediction_order" && a.combo) ? "hedge" : a?.kind === "itinerary" ? "trip" : a ? (checks.length ? "conditional" : "order") : "lookup";
  // A linked stage says what it takes from an earlier one, so the chain reads as a chain.
  const chained = p.research.some((r) => r.bind);
  const nameOf = (id: string) => {
    const i = p.research.findIndex((x) => x.id === id);
    return i >= 0 ? `${i + 1}. ${p.research[i].label}` : id;
  };
  const reads: Block[] = p.research.map((r, i) => {
    const from = Object.entries(r.bind ?? {}).map(([field, ref]) => {
      const m = /^\$([A-Za-z][\w-]*)/.exec(ref);
      return m ? `Uses the ${field === "url" || field === "site" ? "website" : field} from ${nameOf(m[1])}` : "";
    }).filter(Boolean);
    return { label: chained ? `${i + 1}. ${r.label}` : r.label, detail: from.length ? `${from.join("; ")} · ${r.why}` : r.why, cost: lookupCost(r) };
  });
  const does: Block[] = [];
  const gets: Block[] = [];
  if (a) {
    // The amount is in the label itself, so the block carries no separate price.
    does.push(doesLine(a));
    gets.push(getsLine(p));
  } else gets.push(getsLine(p));
  if (p.then?.watch) does.push({ label: "Keep watching", detail: `${p.then.watch.says} ${p.then.watch.every === "1d" ? "Daily" : `Every ${p.then.watch.every}`} for ${p.then.watch.days} days.` });
  const isCombo = a?.kind === "prediction_order" && Boolean(a.combo);
  return {
    kind,
    lanes: lanes({
      reads,
      checks: [
        // The legs are what has to come true, so they sit where the conditions do.
        ...(a?.kind === "prediction_order" && a.combo ? a.combo.legs.map((l) => ({ label: legText(l), detail: `${l.event}${l.price != null ? ` · ${chance(l.price)} on its own` : ""}` })) : []),
        ...checks.map((c) => ({ label: conditionLabel(c), detail: "read fresh, right before" })),
        // Linked jobs are judged by fixed rules in code, across the stages' answers.
        ...(chained && !a ? [{ label: "Checked by fixed rules", detail: "Real phone line? The company's own number? How old is the site? Fair price? Trouble in the news?" }] : []),
      ],
      does,
      gets,
    }).map((l) => (isCombo && l.key === "checks" ? { ...l, title: "All must happen" } : l)),
    costUsd: p.research.reduce((s, r) => s + lookupCost(r), 0) + maxCost(a),
  };
}

/** One sentence for what a move does, for screen readers and the caption under the drawing. */
export const captionOf = (p: Proposal) => (p.action ? p.ask : p.why);
