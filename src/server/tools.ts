import { z } from "zod";
import type { AgentId, MoveAction, MoveCondition, Plan, PlanStep, Proposal, ResearchStep, ToolCall } from "@/lib/types";
import * as gemini from "./gemini";
import * as geo from "./geo";
import { searchServices, networkName, CATEGORIES } from "./marketplace";
import { spotSymbols } from "./agents/ai-planning";
import { PRODUCTS } from "./x402";
import { marketBase, positions as heldPositions, spotFeeBps, tradingVenue, VENUE_NAME } from "./exchange";
import { FEEDS } from "./chainlink";

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
    description:
      "Search active prediction markets on Gemini by keyword (e.g. 'BTC', 'Fed', 'Lakers'). Returns live markets with YES prices (0-1). When a test exchange is connected, `tradable` lists the markets you can actually place orders on there, with that exchange's own prices; orders must use those.",
    params: z.object({ query: z.string().describe("Keyword, asset ticker or team"), limit: z.number().int().min(1).max(6).optional() }),
    async run(a) {
      const shape = (events: gemini.MarketEvent[]) =>
        events.map((e) => ({
          ticker: e.ticker,
          title: e.title,
          category: e.category,
          volume: Math.round(e.volume),
          contracts: e.contracts.filter((c) => c.open !== false).slice(0, 8).map((c) => ({ symbol: c.symbol, label: c.label, last: c.last, bid: c.bid, ask: c.ask, expiry: c.expiry })),
        }));
      const venue = tradingVenue();
      const events = await gemini.searchEvents(String(a.query ?? ""), Number(a.limit ?? 6));
      if (venue !== "gemini-sandbox") return { data: { venue: VENUE_NAME[venue], markets: shape(events) }, summary: `${events.length} markets for “${a.query}”` };
      const tradable = await gemini.searchEvents(String(a.query ?? ""), Number(a.limit ?? 6), marketBase(venue)).catch(() => []);
      return {
        data: { venue: VENUE_NAME[venue], markets: shape(events), tradable: tradable.length ? shape(tradable) : "None. The test exchange lists crypto and commodity markets only; try BTC, ETH, SOL, XRP or Brent." },
        summary: `${events.length} markets for “${a.query}” · ${tradable.length} tradable on ${VENUE_NAME[venue]}`,
      };
    },
  },
  get_market: {
    description: "Full detail of one prediction-market event by ticker: every contract with last, bid and ask. Set tradable=true to read it from the connected exchange (its own prices).",
    params: z.object({ ticker: z.string(), tradable: z.boolean().optional() }),
    async run(a) {
      const e = await gemini.getEvent(String(a.ticker), a.tradable ? marketBase() : undefined);
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
  my_positions: {
    description:
      "The user's open prediction-market positions on the connected exchange: contract, YES/NO, quantity (and how many are free to sell), average entry price, what a sell gets now, profit so far. Each has `swing24h`, how far its price moved in the last 24h on the live market (high minus low, in cents); sorted calmest first by default. Use it before proposing to sell.",
    params: z.object({ sort: z.enum(["calmest", "wildest", "biggest"]).optional() }),
    async run(a) {
      const { venue, positions } = await heldPositions();
      if (venue === "paper") return { data: { venue: VENUE_NAME[venue], positions: [], note: "No exchange is connected, so there are no positions. Connect Gemini (New job → Exchange) to trade and hold contracts." }, summary: "No exchange connected" };
      const day = Date.now() - 86_400_000;
      const withSwing = await Promise.all(
        positions.slice(0, 12).map(async (p) => {
          const pts = (await gemini.oddsHistory(p.symbol, "1hr").catch(() => [])).filter((x) => x.t >= day).map((x) => (p.outcome === "yes" ? x.p : 1 - x.p));
          const swing24h = pts.length >= 2 ? Math.round((Math.max(...pts) - Math.min(...pts)) * 100) : null;
          return { ...p, swing24h };
        }),
      );
      const sort = a.sort ?? "calmest";
      const key = (p: (typeof withSwing)[number]) => (sort === "biggest" ? -p.marketValue : sort === "wildest" ? -(p.swing24h ?? -1) : (p.swing24h ?? 999));
      withSwing.sort((x, y) => key(x) - key(y));
      return {
        data: { venue: VENUE_NAME[venue], positions: withSwing, sortedBy: sort },
        summary: withSwing.length ? `${withSwing.length} positions on ${VENUE_NAME[venue]}` : `No open positions on ${VENUE_NAME[venue]}`,
      };
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
  if (!parsed.success) return { call: { tool: name, args, summary: "Lookup failed", ok: false }, data: { error: parsed.error.issues[0]?.message } };
  try {
    const r = await tool.run(parsed.data as Record<string, unknown>);
    return { call: { tool: name, args, summary: r.summary, ok: true }, data: r.data };
  } catch (e) {
    const down = e instanceof gemini.MarketDataDown;
    const msg = (e as Error).message.slice(0, 120);
    // The chip is for the user: plain words. The detail goes to the model so it can adapt.
    return { call: { tool: name, args, summary: down ? "Gemini didn't answer" : /unknown symbol|404|not found/i.test(msg) ? "Nothing by that name" : "Lookup failed", ok: false, down }, data: { error: msg, retryable: down } };
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
    description: "YES-price history for one contract (args: symbol, tf 5m|15m|1hr). Gemini's public data, sold by Agento's own x402 feed; the agent turns it into a trend reading",
    args: ["symbol", "tf"],
    key: (a) => `history:${a.symbol}`,
    params: (a) => ({ symbol: a.symbol, tf: ["5m", "15m", "1hr"].includes(a.tf) ? a.tf : "15m" }),
  },
  trade_tape: {
    product: "markets.tape",
    description: "Last 100 trades for one contract, shows buyer vs seller flow (args: symbol). Gemini's public data, sold by Agento's own x402 feed; the agent turns it into a flow reading",
    args: ["symbol"],
    key: (a) => `tape:${a.symbol}`,
    params: (a) => ({ symbol: a.symbol }),
  },
  spot_candles: {
    product: "spot.candles",
    description: "Spot price candles for a coin (args: symbol like btcusd, tf 1hr|1day). Gemini's public data, sold by Agento's own x402 feed; the agent turns it into a trend reading",
    args: ["symbol", "tf"],
    key: (a) => `candles:${a.symbol}:${a.tf === "1day" ? "1day" : "1hr"}`,
    params: (a) => ({ symbol: a.symbol, tf: a.tf === "1day" ? "1day" : "1hr" }),
  },
  oracle_price: {
    product: "oracle.chainlink",
    description: "Chainlink oracle price read live from Ethereum mainnet, bought from Quicknode on Circle's Agent Marketplace (args: symbol btcusd|ethusd|solusd|linkusd). An independent check on Gemini's price; can be used in a condition",
    args: ["symbol"],
    key: (a) => `oracle:${a.symbol?.toLowerCase()}`,
    params: (a) => ({ symbol: a.symbol?.toLowerCase() }),
  },
  drive_route: {
    product: "routes.drive",
    description: "Driving route through ordered stops with distance and hours per leg (args: stops, place names joined by |)",
    args: ["stops"],
    key: (a) => `route:${a.stops}`,
    params: (a) => ({ stops: a.stops }),
  },
};

/** Marketplace research is priced by the seller; this is the listed price (Quicknode: 0.0001 USDC per call). */
export const MARKETPLACE_PRICE: Record<string, bigint> = { "oracle.chainlink": 100n };
export const researchPrice = (tool: string) => MARKETPLACE_PRICE[RESEARCH[tool].product] ?? PRODUCTS[RESEARCH[tool].product].price;
export const isMarketplace = (tool: string) => RESEARCH[tool].product in MARKETPLACE_PRICE;

/** Each agent's own harness: what it can look up for free, what it can buy, and what it can do. */
export const TOOLKIT: Record<AgentId, { free: string[]; research: string[] }> = {
  inso: { free: ["search_markets", "get_market", "my_positions", "spot_price", "search_services"], research: ["odds_history", "trade_tape", "oracle_price"] },
  trado: { free: ["spot_price", "search_markets", "get_market", "my_positions", "search_services"], research: ["spot_candles", "oracle_price", "odds_history"] },
  travo: { free: ["find_place", "my_positions", "search_services"], research: ["drive_route"] },
};

export const researchMenu = (agent?: AgentId) =>
  Object.entries(RESEARCH)
    .filter(([id]) => !agent || TOOLKIT[agent].research.includes(id))
    .map(([id, t]) => `- ${id}: ${t.description} · ${(Number(researchPrice(id)) / 1e6).toFixed(4)} USDC`)
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
      z.object({
        kind: z.literal("prediction_order"),
        eventTicker: z.string(),
        symbol: z.string().describe("Exact contract symbol from the tradable list"),
        label: z.string().max(60),
        side: z.enum(["yes", "no"]),
        trade: z
          .enum(["buy", "sell"])
          .nullable()
          .optional()
          .describe("buy (default) opens a position. sell closes contracts the user holds (from my_positions): side is the outcome held, maxPrice is the LOWEST price accepted, orderType limit, quantity at most what's free."),
        orderType: z
          .enum(["limit", "stop-limit"])
          .describe("limit: rests on the book and buys at maxPrice or cheaper, so it covers 'buy if it drops to X'. stop-limit: waits until the price rises to stopPrice, then buys at up to maxPrice, for 'buy once it breaks out to X'."),
        maxPrice: z.number().min(0.01).max(0.99).describe("Buy: highest price per contract (0-1). Sell: lowest price accepted."),
        stopPrice: z.number().min(0.01).max(0.99).nullable().describe("stop-limit only: trigger price, at or above the last trade and at or below maxPrice"),
        quantity: z.number().int().min(1).max(500),
      }),
      z.object({ kind: z.literal("spot_order"), symbol: z.string(), side: z.enum(["buy", "sell"]), limitPrice: z.number().positive(), amountUsd: z.number().min(1).max(100) }),
      z.object({ kind: z.literal("itinerary"), stops: z.array(z.string().min(2).max(60)).min(2).max(6), hoursPerDay: z.number().int().min(2).max(12) }),
    ])
    .nullable()
    .describe("The concrete move. null for research only."),
  condition: z
    .object({ metric: z.enum(["yes_price", "no_price", "spot_price", "oracle_price"]), symbol: z.string(), op: z.enum(["<=", ">="]), value: z.number() })
    .nullable()
    .describe("A check on a DIFFERENT number than the order's own price, read right before placing (e.g. only buy the BTC-above-66k contract if BTC spot ≥ 64k). The order's own price target goes in orderType/maxPrice/stopPrice, not here. null for none."),
  budgetUsd: z.number().positive().nullable().describe("The most the user said they'd spend on this order in USD, if they said; enforced."),
  hedge: z
    .object({ protects: z.string().max(80).describe("What the user stands to lose, in their words: 'a pricier Uber if it's freezing Saturday'"), lossUsd: z.number().positive().max(1000).describe("Roughly what that would cost them in USD") })
    .nullable()
    .optional()
    .describe("Set when the order is insurance: the user loses money if some event happens, so they buy the side that pays out if it does. Code then sizes the order to cover lossUsd (or to fit budgetUsd) and shows cost vs payout. prediction_order buys only."),
});
export type ProposalInput = z.infer<typeof ProposalInput>;

import { limits } from "./settings";
const round2 = (x: number) => Math.round(x * 100) / 100;
/** An order needs time to rest; refuse contracts closing sooner than this. */
const MIN_EXPIRY_MS = Number(process.env.MIN_ORDER_EXPIRY_MIN ?? 20) * 60_000;

/**
 * Checks a move against the exchange it would trade on and the user's limits.
 * Fixes what's safe to fix (rounding, budget) and says so; refuses the rest with a reason the model can act on.
 */
export async function validateProposal(agent: AgentId, input: unknown, id: string): Promise<{ proposal: Proposal } | { error: string }> {
  const parsed = ProposalInput.safeParse(input);
  if (!parsed.success) return { error: `Invalid move: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  const p = parsed.data;
  const venue = tradingVenue();
  const adjustments: string[] = [];
  let eventContracts: string[] = [];
  let market: Proposal["market"];
  const budget = p.budgetUsd ?? undefined;
  let action: MoveAction | undefined;
  const raw = p.action ?? undefined;
  if (raw && !ACTIONS[agent].includes(raw.kind)) return { error: `This agent can't do ${raw.kind}. Allowed: ${ACTIONS[agent].join(", ")}` };
  if (!raw && p.research.length === 0) return { error: "A move needs an action or at least one paid lookup" };

  if (raw?.kind === "prediction_order") {
    const ev = await gemini.getEvent(raw.eventTicker, marketBase(venue)).catch(() => null);
    const c = ev?.contracts.find((x) => x.symbol === raw.symbol);
    if (!ev || !c)
      return {
        error:
          venue === "gemini-sandbox"
            ? `${raw.symbol} isn't listed on ${VENUE_NAME[venue]}. Only markets in search_markets' "tradable" list can be ordered; pick one of those or explain to the user that this market can't be traded here.`
            : `Contract ${raw.symbol} not found in event ${raw.eventTicker}`,
      };
    if (c.open === false) return { error: `${c.label} isn't open for trading right now` };
    const left = c.expiry ? Date.parse(c.expiry) - Date.now() : Infinity;
    if (left < MIN_EXPIRY_MS) return { error: `${c.label} closes ${left <= 0 ? "now" : `in ${Math.max(1, Math.round(left / 60_000))} min`}; too soon for an order to rest. Pick a later contract.` };
    const maxPrice = round2(raw.maxPrice);
    let quantity = raw.quantity;
    // A hedge is sized by code: enough contracts that the payout, after their cost, covers the loss.
    if (p.hedge && raw.trade !== "sell" && budget == null) {
      const need = Math.min(500, Math.max(1, Math.ceil(p.hedge.lossUsd / (1 - maxPrice) - 1e-9)));
      const fits = Math.max(1, Math.floor(limits().maxOrderUsd / maxPrice));
      const sized = Math.min(need, fits);
      if (sized !== quantity) adjustments.push(sized < need ? `Sized to ${sized} contracts, the most your $${limits().maxOrderUsd} order limit allows` : `Sized to ${sized} contracts so the payout covers your $${p.hedge.lossUsd}`);
      quantity = sized;
    }
    if (raw.trade === "sell") {
      const sold = await checkSell(raw, c, maxPrice, venue);
      if ("error" in sold) return sold;
      action = sold.action;
      adjustments.push(...sold.notes);
      if (Number.isFinite(left)) adjustments.push(`Contract closes ${new Date(Date.parse(c.expiry!)).toUTCString().replace(/:\d\d GMT$/, " UTC")}`);
      eventContracts = ev.contracts.map((x) => x.symbol);
      market = { ask: raw.side === "yes" ? c.ask : c.bid != null ? round2(1 - c.bid) : null, bid: sold.bidNow, closesAt: c.expiry };
    } else {
    let stopPrice = raw.stopPrice != null ? round2(raw.stopPrice) : undefined;
    if (raw.orderType === "stop-limit") {
      if (stopPrice == null) return { error: "stop-limit needs stopPrice" };
      if (c.last != null && stopPrice < c.last) return { error: `stopPrice ${stopPrice} is below the last trade ${c.last}; a buy stop must trigger at or above it. For 'buy if it drops to X' use a plain limit order at X.` };
      if (stopPrice > maxPrice) return { error: "stopPrice must be at or below maxPrice" };
    } else stopPrice = undefined;
    if (budget != null && maxPrice * quantity > budget + 1e-9) {
      quantity = Math.floor(budget / maxPrice + 1e-9);
      if (quantity < 1) return { error: `Budget $${budget} can't buy one contract at ${Math.round(maxPrice * 100)}¢` };
      adjustments.push(`Quantity cut to ${quantity} to stay within your $${budget}`);
    }
    if (maxPrice * quantity > limits().maxOrderUsd) return { error: `Order over the user's $${limits().maxOrderUsd} per-order limit (set in Settings). Make it smaller.` };
    if (maxPrice !== raw.maxPrice) adjustments.push(`Price rounded to ${Math.round(maxPrice * 100)}¢`);
    action = { kind: "prediction_order", eventTicker: raw.eventTicker, symbol: raw.symbol, label: raw.label, side: raw.side, orderType: raw.orderType, maxPrice, stopPrice, quantity };
    // Tell the user whether this buys now or waits: the cheapest seller right now is the ask.
    const askNow = raw.side === "yes" ? c.ask : c.bid != null ? round2(1 - c.bid) : null;
    if (raw.orderType === "limit" && askNow != null)
      adjustments.push(
        maxPrice >= askNow
          ? `Fills now: cheapest ${raw.side.toUpperCase()} seller is at ${Math.round(askNow * 100)}¢${venue === "paper" ? "" : "; Gemini's taker fee applies"}`
          : `Waits on the book: cheapest ${raw.side.toUpperCase()} seller is at ${Math.round(askNow * 100)}¢ now${venue === "paper" ? "" : "; no maker fee through Dec 31 2026 if it fills that way"}`,
      );
    else if (raw.orderType === "limit") adjustments.push("Waits on the book: no sellers right now");
    if (Number.isFinite(left)) adjustments.push(`Contract closes ${new Date(Date.parse(c.expiry!)).toUTCString().replace(/:\d\d GMT$/, " UTC")}`);
    eventContracts = ev.contracts.map((x) => x.symbol);
    market = { ask: raw.side === "yes" ? c.ask : c.bid != null ? round2(1 - c.bid) : null, bid: raw.side === "yes" ? c.bid : c.ask != null ? round2(1 - c.ask) : null, closesAt: c.expiry };
    }
  } else if (raw?.kind === "spot_order") {
    const symbol = raw.symbol.toLowerCase();
    const list = await spotSymbols().catch(() => [] as string[]);
    if (list.length && !list.includes(symbol)) return { error: `Unknown symbol ${raw.symbol}` };
    let amountUsd = raw.amountUsd;
    // The fee comes on top of the amount, so the budget has to cover both.
    const fee = (await spotFeeBps().catch(() => ({ maker: 0, taker: 0 }))).taker / 10_000;
    if (budget != null && amountUsd * (1 + fee) > budget + 1e-9) {
      amountUsd = Math.floor((budget / (1 + fee)) * 100) / 100;
      adjustments.push(`Amount cut to $${amountUsd} so it plus the fee stays within your $${budget}`);
    }
    if (fee > 0) adjustments.push(`Fee up to $${Math.max(0.01, amountUsd * fee).toFixed(2)} (${(fee * 100).toFixed(2)}% if it fills right away, less if it rests)`);
    if (amountUsd > limits().maxOrderUsd) return { error: `Order over the user's $${limits().maxOrderUsd} per-order limit (set in Settings). Make it smaller.` };
    action = { ...raw, symbol, amountUsd };
  } else if (raw) action = raw;

  for (const r of p.research) {
    const t = RESEARCH[r.tool];
    if (!TOOLKIT[agent].research.includes(r.tool)) return { error: `This agent can't buy ${r.tool}. It can buy: ${TOOLKIT[agent].research.join(", ")}` };
    if (r.tool === "oracle_price" && !FEEDS[r.args.symbol?.toLowerCase()]) return { error: `No Chainlink feed for ${r.args.symbol}. Available: ${Object.keys(FEEDS).join(", ")}` };
    const missing = t.args.filter((x) => x !== "tf" && !r.args[x]);
    if (missing.length) return { error: `${r.tool} needs ${missing.join(", ")}` };
    // Paid lookups read live Gemini data. Don't charge the user for a symbol that has none.
    if (r.tool === "odds_history" || r.tool === "trade_tape") {
      const known = await gemini.recentTrades(r.args.symbol, 1).then(() => true, () => false);
      if (!known) return { error: `${r.args.symbol} has no live market data to buy${venue === "gemini-sandbox" ? " (test-exchange-only contracts have none; research the live market with the same strike, or drop the research)" : ""}` };
    }
    if (r.tool === "spot_candles") {
      const list = await spotSymbols().catch(() => [] as string[]);
      if (list.length && !list.includes(r.args.symbol?.toLowerCase())) return { error: `Unknown spot symbol ${r.args.symbol}` };
    }
  }

  // A condition on the order's own price adds nothing: the exchange enforces the limit, and it keeps resting.
  let condition = (p.condition ?? undefined) as MoveCondition | undefined;
  // Only accept checks the app can actually read right before placing.
  if (condition?.metric === "oracle_price") {
    const sym = condition.symbol.toLowerCase();
    if (!p.research.some((r) => r.tool === "oracle_price" && r.args.symbol?.toLowerCase() === sym))
      return { error: `An oracle_price condition needs an oracle_price research step for ${sym}, so the price is bought right before the check` };
    condition = { ...condition, symbol: sym };
  } else if (condition?.metric === "spot_price") {
    const list = await spotSymbols().catch(() => [] as string[]);
    if (list.length && !list.includes(condition.symbol.toLowerCase())) return { error: `Condition uses unknown spot symbol ${condition.symbol}` };
    condition = { ...condition, symbol: condition.symbol.toLowerCase() };
  } else if (condition && !eventContracts.includes(condition.symbol))
    return { error: "A price condition must be on a contract in the same event as the order, or on a spot price (spot_price)" };
  if (condition && action?.kind === "prediction_order" && condition.symbol === action.symbol && condition.metric !== "spot_price") {
    condition = undefined;
    adjustments.push("Price check folded into the order: it rests on the exchange until the price is right");
  }
  if (condition && action?.kind === "spot_order" && condition.metric === "spot_price" && condition.symbol === action.symbol) {
    condition = undefined;
    adjustments.push("Price check folded into the limit order");
  }
  // The same lookup twice is the same data paid for twice: keep one.
  const seen = new Set<string>();
  const unique = p.research.filter((r) => {
    const k = `${r.tool}:${JSON.stringify(Object.fromEntries(Object.entries(r.args).map(([a, v]) => [a, String(v).toLowerCase()]).sort()))}`;
    if (seen.has(k)) {
      adjustments.push(`Already includes ${r.label}; not buying it twice`);
      return false;
    }
    seen.add(k);
    return true;
  });
  if (venue === "gemini-sandbox" && action && action.kind !== "itinerary" && unique.some((r) => r.tool !== "oracle_price"))
    adjustments.push("Data from the live Gemini market; the order trades on Gemini's test exchange, where prices can differ");
  const research: ResearchStep[] = unique.map((r, i) => ({ id: `r${i + 1}`, tool: r.tool, args: r.args, label: r.label, why: r.why }));
  return {
    proposal: {
      id,
      title: p.title,
      why: p.why,
      // A hedge's question is written from the sized order, so its numbers are always the real ones.
      ask: hedgeOf(p.hedge, action) && action?.kind === "prediction_order" ? `Pay up to $${round2(action.maxPrice * action.quantity).toFixed(2)} now; get $${action.quantity} back if “${action.label}” ${action.side === "yes" ? "happens" : "doesn't happen"}?` : p.ask,
      research,
      action,
      condition,
      venue: action && action.kind !== "itinerary" ? venue : "paper",
      budgetUsd: budget,
      hedge: hedgeOf(p.hedge, action),
      market,
      adjustments: adjustments.length ? adjustments : undefined,
    },
  };
}

/** A stored move in the shape the model writes and the validator reads. */
/** Cost and payout of a hedge, from the order as it will actually be placed. */
function hedgeOf(h: ProposalInput["hedge"], a: MoveAction | undefined): Proposal["hedge"] {
  if (!h || a?.kind !== "prediction_order" || a.trade === "sell") return undefined;
  return { protects: h.protects, lossUsd: h.lossUsd, cost: round2(a.maxPrice * a.quantity), payout: a.quantity };
}

type RawPrediction = Extract<NonNullable<ProposalInput["action"]>, { kind: "prediction_order" }>;

/** A sell must close contracts the user actually holds and has free, as a resting limit. */
async function checkSell(raw: RawPrediction, c: gemini.MarketContract, price: number, venue: Proposal["venue"]): Promise<{ action: MoveAction; notes: string[]; bidNow: number | null } | { error: string }> {
  if (venue === "paper") return { error: "No exchange is connected, so the user holds nothing to sell. Say so; selling needs Gemini connected (New job → Exchange)." };
  if (raw.orderType !== "limit") return { error: "Sells are plain limit orders: set orderType limit and maxPrice to the lowest price the user accepts." };
  const held = (await heldPositions().catch(() => null))?.positions.find((x) => x.symbol === raw.symbol && x.outcome === raw.side);
  if (!held) return { error: `The user holds no ${raw.side.toUpperCase()} contracts of ${raw.symbol}. Check my_positions and sell only what's there.` };
  if (held.available < 1) return { error: `All ${held.quantity} ${raw.side.toUpperCase()} contracts of ${held.label} are on hold for an open order. Cancel that order first.` };
  const notes: string[] = [];
  let quantity = raw.quantity;
  if (quantity > held.available) {
    quantity = held.available;
    notes.push(`Quantity cut to ${quantity}, all you hold free`);
  }
  if (price !== raw.maxPrice) notes.push(`Price rounded to ${Math.round(price * 100)}¢`);
  // Someone buying YES pays the YES bid; someone buying NO pays 1 − the YES ask.
  const bidNow = raw.side === "yes" ? c.bid : c.ask != null ? round2(1 - c.ask) : null;
  notes.push(bidNow == null ? "Waits on the book: no buyers right now" : price <= bidNow ? `Sells now: best buyer pays ${Math.round(bidNow * 100)}¢` : `Waits on the book: best buyer pays ${Math.round(bidNow * 100)}¢ now`);
  const pnl = Math.round((price - held.avgPrice) * quantity * 100) / 100;
  notes.push(`You paid ${Math.round(held.avgPrice * 100)}¢ avg, so this ${pnl >= 0 ? "locks in" : "takes a loss of"} about $${Math.abs(pnl).toFixed(2)}`);
  return { action: { kind: "prediction_order", eventTicker: raw.eventTicker, symbol: raw.symbol, label: raw.label, side: raw.side, trade: "sell", orderType: "limit", maxPrice: price, quantity }, notes, bidNow };
}

export function toProposalInput(p: Proposal): ProposalInput {
  const a = p.action;
  return {
    title: p.title,
    why: p.why,
    ask: p.ask,
    research: p.research.map((r) => ({ tool: r.tool, args: r.args, label: r.label, why: r.why })),
    action: !a ? null : a.kind === "prediction_order" ? { ...a, trade: a.trade ?? null, stopPrice: a.stopPrice ?? null } : a,
    condition: p.condition ?? null,
    budgetUsd: p.budgetUsd ?? null,
    hedge: p.hedge ? { protects: p.hedge.protects, lossUsd: p.hedge.lossUsd } : null,
  } as ProposalInput;
}

/** Right before approval: is the move still placeable? Markets close and contracts expire while you think. */
export async function stillTradable(p: Proposal): Promise<string | null> {
  const a = p.action;
  if (!a || a.kind !== "prediction_order" || p.venue === "paper") return null;
  const ev = await gemini.getEvent(a.eventTicker, marketBase(p.venue)).catch(() => null);
  const c = ev?.contracts.find((x) => x.symbol === a.symbol);
  if (!c) return "This market is no longer listed. Go back to chat for a new move.";
  if (c.open === false) return `${c.label} closed for trading since this move was proposed. Go back to chat for a new move.`;
  const left = c.expiry ? Date.parse(c.expiry) - Date.now() : Infinity;
  if (left < MIN_EXPIRY_MS / 2) return `${c.label} closes too soon for this order now. Go back to chat for a new move.`;
  return null;
}

export { pctOf };

// ---------- plans: several moves, possibly for different agents, in order ----------

export const PlanInput = z.object({
  title: z.string().max(70),
  why: z.string().max(240).describe("One or two sentences: how the steps fit together"),
  steps: z
    .array(
      z.object({
        agent: z.enum(["inso", "trado", "travo"]).describe("inso: prediction-market orders and sells. trado: spot crypto orders. travo: driving itineraries."),
        gate: z.enum(["done", "filled"]).describe("done: start once the step before finishes. filled: only once the step before's order has filled (e.g. spend what a sell brought in)."),
        move: ProposalInput,
      }),
    )
    .min(2)
    .max(4),
  unavailable: z
    .array(z.object({ what: z.string().max(80), why: z.string().max(160) }))
    .max(4)
    .describe("Parts of the request no agent can do here, e.g. booking a hotel (travel booking services on Circle's marketplace take Arc mainnet only). Empty if everything is covered."),
});
export type PlanInput = z.infer<typeof PlanInput>;

/** Every step checked as if proposed on its own, by the agent that will run it. */
export async function validatePlan(input: unknown, id: string): Promise<{ plan: Plan } | { error: string }> {
  const parsed = PlanInput.safeParse(input);
  if (!parsed.success) return { error: `Invalid plan: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  const p = parsed.data;
  const steps: PlanStep[] = [];
  for (const [i, s] of p.steps.entries()) {
    if (i === 0 && s.gate === "filled") return { error: "Step 1 has nothing before it; its gate must be done" };
    if (s.gate === "filled") {
      const prev = steps[i - 1].proposal.action;
      if (!prev || prev.kind === "itinerary") return { error: `Step ${i + 1} waits for an order to fill, but step ${i} places no order. Use gate done.` };
    }
    const v = await validateProposal(s.agent, s.move, `${id}-s${i + 1}`);
    if ("error" in v) return { error: `Step ${i + 1} (${s.agent}): ${v.error}` };
    steps.push({ id: `s${i + 1}`, agent: s.agent, proposal: v.proposal, gate: s.gate, status: "waiting" });
  }
  return { plan: { id, title: p.title, why: p.why, steps, unavailable: p.unavailable, status: "proposed" } };
}
