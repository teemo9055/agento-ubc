import { z } from "zod";
import type { AgentId, MoveAction, MoveCondition, Proposal, ResearchStep, ToolCall } from "@/lib/types";
import * as gemini from "./gemini";
import * as geo from "./geo";
import { searchServices, networkName, CATEGORIES } from "./marketplace";
import { spotSymbols } from "./agents/ai-planning";
import { PRODUCTS } from "./x402";

/**
 * Two kinds of tools.
 * Free tools: the agent calls them while exploring with you (snapshots, catalog search).
 * Paid research: priced per request, bought through x402 only after you approve the move.
 */

// ---------- free tools ----------

interface FreeTool {
  description: string;
  params: z.ZodObject;
  run(args: Record<string, unknown>): Promise<{ data: unknown; summary: string }>;
}

const pctOf = (p: number | null) => (p == null ? "—" : `${Math.round(p * 100)}¢`);

export const FREE_TOOLS: Record<string, FreeTool> = {
  search_markets: {
    description: "Search active prediction markets on Gemini by keyword (e.g. 'BTC', 'Fed', 'Lakers'). Returns events with their contracts and current YES prices (0-1).",
    params: z.object({ query: z.string().describe("Keyword, asset ticker or team"), limit: z.number().int().min(1).max(10).optional() }),
    async run(a) {
      const events = await gemini.searchEvents(String(a.query ?? ""), Number(a.limit ?? 6));
      const data = events.map((e) => ({
        ticker: e.ticker,
        title: e.title,
        category: e.category,
        volume: Math.round(e.volume),
        contracts: e.contracts.slice(0, 8).map((c) => ({ symbol: c.symbol, label: c.label, last: c.last, bid: c.bid, ask: c.ask, expiry: c.expiry })),
      }));
      return { data, summary: `${events.length} markets for “${a.query}”` };
    },
  },
  get_market: {
    description: "Full detail of one prediction-market event by ticker: every contract with last, bid and ask.",
    params: z.object({ ticker: z.string() }),
    async run(a) {
      const e = await gemini.getEvent(String(a.ticker));
      return { data: e, summary: `${e.title} · ${e.contracts.length} contracts` };
    },
  },
  spot_price: {
    description: "Current spot price, bid/ask and 24h change for a Gemini symbol like btcusd, ethusd, solusd.",
    params: z.object({ symbol: z.string().describe("Lowercase Gemini symbol ending in usd") }),
    async run(a) {
      const sym = String(a.symbol).toLowerCase();
      const list = await spotSymbols().catch(() => [] as string[]);
      if (list.length && !list.includes(sym)) throw new Error(`unknown symbol ${sym}`);
      const q = await gemini.spotTicker(sym);
      return { data: q, summary: `${sym.replace(/usd$/, "").toUpperCase()} $${q.last.toLocaleString()} (${q.change24h == null ? "—" : `${(q.change24h * 100).toFixed(1)}%`} 24h)` };
    },
  },
  find_place: {
    description: "Look up a place by name (OpenStreetMap). Returns name and coordinates.",
    params: z.object({ query: z.string() }),
    async run(a) {
      const p = await geo.geocode(String(a.query));
      return { data: p, summary: p ? `Found ${p.name}` : `No match for “${a.query}”` };
    },
  },
  search_services: {
    description: `Search Circle's Agent Marketplace for paid data and AI services other agents sell over x402. Categories: ${CATEGORIES.join(", ")}. Each result says whether it accepts Arc testnet (payable now) or only mainnet networks.`,
    params: z.object({ query: z.string(), category: z.enum(CATEGORIES).optional() }),
    async run(a) {
      const list = await searchServices(String(a.query ?? ""), a.category as string | undefined);
      const data = list.map((s) => ({ ...s, networks: s.networks.map(networkName) }));
      const here = list.filter((s) => s.payableHere).length;
      return { data, summary: `${list.length} marketplace services for “${a.query}” · ${here} payable on Arc testnet` };
    },
  },
};

export async function runFreeTool(name: string, args: Record<string, unknown>): Promise<{ call: ToolCall; data: unknown }> {
  const tool = FREE_TOOLS[name];
  if (!tool) return { call: { tool: name, args, summary: "Unknown tool", ok: false }, data: { error: "unknown tool" } };
  const parsed = tool.params.safeParse(args);
  if (!parsed.success) return { call: { tool: name, args, summary: "Bad arguments", ok: false }, data: { error: parsed.error.issues[0]?.message } };
  try {
    const r = await tool.run(parsed.data as Record<string, unknown>);
    return { call: { tool: name, args, summary: r.summary, ok: true }, data: r.data };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 120);
    return { call: { tool: name, args, summary: `Failed: ${msg}`, ok: false }, data: { error: msg } };
  }
}

// ---------- paid research (bought after approval) ----------

export interface ResearchTool {
  product: string;
  description: string;
  args: string[];
  /** Feed key; widgets read data by it. */
  key(args: Record<string, string>): string;
  params(args: Record<string, string>): Record<string, string>;
}

export const RESEARCH: Record<string, ResearchTool> = {
  odds_history: {
    product: "markets.history",
    description: "YES-price history for one contract (args: symbol, tf 5m|15m|1hr)",
    args: ["symbol", "tf"],
    key: (a) => `history:${a.symbol}`,
    params: (a) => ({ symbol: a.symbol, tf: ["5m", "15m", "1hr"].includes(a.tf) ? a.tf : "15m" }),
  },
  trade_tape: {
    product: "markets.tape",
    description: "Last 100 trades for one contract, shows buyer vs seller flow (args: symbol)",
    args: ["symbol"],
    key: (a) => `tape:${a.symbol}`,
    params: (a) => ({ symbol: a.symbol }),
  },
  spot_candles: {
    product: "spot.candles",
    description: "Spot price candles for a coin (args: symbol like btcusd, tf 1hr|1day)",
    args: ["symbol", "tf"],
    key: (a) => `candles:${a.symbol}:${a.tf === "1day" ? "1day" : "1hr"}`,
    params: (a) => ({ symbol: a.symbol, tf: a.tf === "1day" ? "1day" : "1hr" }),
  },
  drive_route: {
    product: "routes.drive",
    description: "Driving route through ordered stops with distance and hours per leg (args: stops, place names joined by |)",
    args: ["stops"],
    key: (a) => `route:${a.stops}`,
    params: (a) => ({ stops: a.stops }),
  },
};

export const researchPrice = (tool: string) => PRODUCTS[RESEARCH[tool].product].price;

export const researchMenu = () =>
  Object.entries(RESEARCH)
    .map(([id, t]) => `- ${id}: ${t.description} · ${(Number(researchPrice(id)) / 1e6).toFixed(3)} USDC`)
    .join("\n");

/** What each agent may propose to do. */
export const ACTIONS: Record<AgentId, MoveAction["kind"][]> = {
  inso: ["prediction_order"],
  trado: ["spot_order", "prediction_order"],
  travo: ["itinerary"],
};

// ---------- proposal schema (shared by the built-in agent and outside AIs over MCP) ----------

export const ProposalInput = z.object({
  title: z.string().min(3).max(60).describe("Short name for the move, e.g. 'Buy YES: Dallas wins'"),
  why: z.string().max(240).describe("One or two sentences: why this move, based on what you found"),
  ask: z.string().max(160).describe("The yes/no question for the user, e.g. 'Buy 10 YES at 55¢ or less if the odds are still under 60%?'"),
  research: z
    .array(z.object({ tool: z.enum(Object.keys(RESEARCH) as [string, ...string[]]), args: z.record(z.string(), z.string()), label: z.string().max(50), why: z.string().max(100) }))
    .max(4)
    .describe("Paid lookups to run before acting. Empty if the free data already settles it."),
  action: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("prediction_order"), eventTicker: z.string(), symbol: z.string(), label: z.string().max(60), side: z.enum(["yes", "no"]), maxPrice: z.number().min(0.01).max(0.99), quantity: z.number().int().min(1).max(100) }),
      z.object({ kind: z.literal("spot_order"), symbol: z.string(), side: z.enum(["buy", "sell"]), limitPrice: z.number().positive(), amountUsd: z.number().min(1).max(100) }),
      z.object({ kind: z.literal("itinerary"), stops: z.array(z.string().min(2).max(60)).min(2).max(6), hoursPerDay: z.number().int().min(2).max(12) }),
    ])
    .nullable()
    .describe("The concrete move. null for research only."),
  condition: z
    .object({ metric: z.enum(["yes_price", "no_price", "spot_price"]), symbol: z.string(), op: z.enum(["<=", ">="]), value: z.number() })
    .nullable()
    .describe("Checked on fresh data right before acting; the action is skipped if false. null for no condition."),
});
export type ProposalInput = z.infer<typeof ProposalInput>;

const MAX_NOTIONAL = Number(process.env.MAX_ORDER_USD ?? 50);

/** Checks a proposal against live data and the agent's limits. Returns a proposal or a reason. */
export async function validateProposal(agent: AgentId, input: unknown, id: string): Promise<{ proposal: Proposal } | { error: string }> {
  const parsed = ProposalInput.safeParse(input);
  if (!parsed.success) return { error: `Invalid move: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  const p = parsed.data;
  const action = p.action ?? undefined;
  if (action && !ACTIONS[agent].includes(action.kind)) return { error: `This agent can't do ${action.kind}. Allowed: ${ACTIONS[agent].join(", ")}` };
  if (!action && p.research.length === 0) return { error: "A move needs an action or at least one paid lookup" };

  if (action?.kind === "prediction_order") {
    const ev = await gemini.getEvent(action.eventTicker).catch(() => null);
    const c = ev?.contracts.find((x) => x.symbol === action.symbol);
    if (!ev || !c) return { error: `Contract ${action.symbol} not found in event ${action.eventTicker}` };
    if (action.maxPrice * action.quantity > MAX_NOTIONAL) return { error: `Order over the ${MAX_NOTIONAL} USD limit` };
  }
  if (action?.kind === "spot_order") {
    const list = await spotSymbols().catch(() => [] as string[]);
    if (list.length && !list.includes(action.symbol.toLowerCase())) return { error: `Unknown symbol ${action.symbol}` };
    if (action.amountUsd > MAX_NOTIONAL) return { error: `Order over the ${MAX_NOTIONAL} USD limit` };
  }
  for (const r of p.research) {
    const t = RESEARCH[r.tool];
    const missing = t.args.filter((a) => a !== "tf" && !r.args[a]);
    if (missing.length) return { error: `${r.tool} needs ${missing.join(", ")}` };
  }
  // An order's own limit is the real ceiling: a looser price condition would only confuse.
  let condition = (p.condition ?? undefined) as MoveCondition | undefined;
  if (condition && action?.kind === "prediction_order" && condition.metric === `${action.side}_price` && condition.op === "<=" && condition.value > action.maxPrice) condition = { ...condition, value: action.maxPrice };
  if (condition && action?.kind === "spot_order" && condition.metric === "spot_price" && action.side === "buy" && condition.op === "<=" && condition.value > action.limitPrice) condition = { ...condition, value: action.limitPrice };
  const research: ResearchStep[] = p.research.map((r, i) => ({ id: `r${i + 1}`, tool: r.tool, args: r.args, label: r.label, why: r.why }));
  return {
    proposal: {
      id,
      title: p.title,
      why: p.why,
      ask: p.ask,
      research,
      action: action && action.kind === "spot_order" ? { ...action, symbol: action.symbol.toLowerCase() } : action,
      condition,
    },
  };
}

export { pctOf };
