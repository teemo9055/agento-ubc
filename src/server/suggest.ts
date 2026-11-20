import type { AgentId, Proposal } from "@/lib/types";
import { notPossible } from "@/lib/impossible";
import { FEEDS } from "./chainlink";
import { TOOLKIT, researchPrice } from "./tools";

/**
 * The reply chips under an agent message. The model proposes some; code makes sure there are
 * always two or three that fit the moment and that the agent can really do.
 */

const DEFAULTS: Record<AgentId, string[]> = {
  inso: ["What's trading on BTC?", "Hedge a cost I'm worried about", "Show my positions"],
  trado: ["How's BTC doing today?", "Buy $10 of ETH on a 2% dip", "Compare BTC and ETH"],
  worko: ["Plan a drive from Vancouver to Seattle", "Find hotels near my stop", "EV chargers along the way"],
};

const price = (tool: string) => {
  const p = Number(researchPrice(tool)) / 1e6;
  return p < 0.01 ? p.toFixed(4) : p.toFixed(2);
};

/** Useful changes to a move, from what it doesn't have yet. */
export function tweaksFor(agent: AgentId, p: Proposal): string[] {
  const a = p.action;
  const out: string[] = [];
  // A second, independent source is worth offering even when the move already has a check.
  const oracleChecked = [p.condition, ...(p.also ?? [])].some((c) => c?.metric === "oracle_price");
  const can = (tool: string) => TOOLKIT[agent].research.includes(tool) && !p.research.some((r) => r.tool === tool);
  if (a?.kind === "prediction_order" && a.trade !== "sell") {
    const coin = Object.keys(FEEDS).find((s) => a.symbol.toLowerCase().includes(s.replace(/usd$/, "")));
    if (coin && can("oracle_price") && !oracleChecked) out.push(`Only if Chainlink agrees ($${price("oracle_price")})`);
    if (can("odds_history")) out.push(`Check the odds history first ($${price("odds_history")})`);
    if (a.quantity > 2) out.push(`Make it ${Math.max(1, Math.round(a.quantity / 2))} contracts`);
    if (can("trade_tape")) out.push(`See who's buying first ($${price("trade_tape")})`);
    if (!p.hedge && a.maxPrice > 0.05) out.push(`Only if it drops to ${Math.round((a.maxPrice - 0.03) * 100)}¢`);
  } else if (a?.kind === "prediction_order") {
    out.push(`Ask ${Math.min(99, Math.round(a.maxPrice * 100) + 2)}¢ instead`);
    if (a.quantity > 1) out.push(`Sell only ${Math.max(1, Math.round(a.quantity / 2))}`);
  } else if (a?.kind === "spot_order") {
    if (can("oracle_price") && FEEDS[a.symbol] && !oracleChecked) out.push(`Only if Chainlink agrees ($${price("oracle_price")})`);
    if (can("spot_candles")) out.push(`Check the trend first ($${price("spot_candles")})`);
    if (a.amountUsd > 2) out.push(`Make it $${Math.max(1, Math.round(a.amountUsd / 2))}`);
  } else if (a?.kind === "itinerary") {
    out.push(a.hoursPerDay > 4 ? `Max ${a.hoursPerDay - 2} hours a day` : `Up to ${a.hoursPerDay + 2} hours a day`);
    out.push("Add a stop on the way");
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function suggestionsFor(agent: AgentId, fromModel: string[], opts: { proposal?: Proposal; plan?: boolean } = {}): string[] {
  // A chip never offers something nothing here can do.
  fromModel = fromModel.filter((s) => !notPossible(s));
  const seen = new Set<string>();
  // Two chips are the same idea if they share a topic word, however they're phrased.
  const TOPICS = ["chainlink", "history", "trend", "candles", "flow", "tape", "contracts", "hours", "stop", "drops", "cheaper", "smaller", "half"];
  const add = (list: string[], out: string[], max: number) => {
    for (const s of list) {
      const n = norm(s);
      const k = TOPICS.find((t) => n.includes(t)) ?? n.split(" ").slice(0, 3).join(" ");
      if (out.length >= max || !s || seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  };
  const accept = /^(yes|yep|ok|set it up|start)/i;
  if (opts.plan) return add(["Not now", ...fromModel.filter((s) => !accept.test(s))], ["Yes, start the plan"], 3);
  if (opts.proposal) {
    const out = ["Yes, set it up"];
    // Up to four ways to change it: they are the quick options above the chat box.
    add(fromModel.filter((s) => !accept.test(s)).slice(0, 1), out, 5);
    add(tweaksFor(agent, opts.proposal), out, 5);
    return add(["Not now"], out, 6);
  }
  return add(DEFAULTS[agent], add(fromModel.filter((s) => !accept.test(s)), [], 3), 3);
}
