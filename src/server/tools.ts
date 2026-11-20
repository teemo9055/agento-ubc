import { z } from "zod";
import { currentNet, onMainnet } from "./netContext";
import { searchCapabilities } from "./catalog/search";
import { allCapabilities, getCapability, reliability } from "./catalog/store";
import type { AgentId, MoveAction, MoveCondition, Plan, PlanStep, Proposal, ResearchStep, ToolCall } from "@/lib/types";
import * as gemini from "./gemini";
import * as geo from "./geo";
import { findService, networkName, quoteService, searchServices, CATEGORIES } from "./marketplace";
import { isVendorTool, VENDOR_TOOLS } from "./vendor-tools";
import { EVM_CHAINS } from "./onchain";
import { isAddress } from "viem";
import { spotSymbols } from "./agents/ai-planning";
import { PRODUCTS } from "./x402";
import { marketBase, positions as heldPositions, spotFeeBps, tradingVenue, VENUE_NAME } from "./exchange";
import { FEEDS } from "./chainlink";
import { checkQuestion, readArc } from "./chain-tools";

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
      "Search active prediction markets on Gemini by keyword (e.g. 'BTC', 'Fed', 'Lakers'). Returns live markets with YES prices (0-1). With a test exchange connected, `tradable` lists what can be ordered there, at its own prices; orders must use those.",
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
      const events = await gemini.findEvents(String(a.query ?? ""), Number(a.limit ?? 6));
      if (venue !== "gemini-sandbox") return { data: { venue: VENUE_NAME[venue], markets: shape(events) }, summary: `${events.length} markets for “${a.query}”` };
      const tradable = await gemini.findEvents(String(a.query ?? ""), Number(a.limit ?? 6), marketBase(venue)).catch(() => []);
      return {
        data: { venue: VENUE_NAME[venue], markets: shape(events), tradable: tradable.length ? shape(tradable) : "None. The test exchange lists crypto and commodity markets only; try BTC, ETH, SOL, XRP or Brent." },
        summary: `${events.length} markets for “${a.query}” · ${tradable.length} tradable on ${VENUE_NAME[venue]}`,
      };
    },
  },
  get_market: {
    description: "One prediction-market event by ticker: every contract with last, bid and ask. tradable=true reads it from the connected exchange.",
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
  browse_markets: {
    description:
      "Gemini's lists, no keyword needed: new = just listed, upcoming = opening soon, settled = just resolved (with how each contract resolved).",
    params: z.object({ list: z.enum(["new", "upcoming", "settled"]), category: z.string().optional().describe("Only this category, e.g. Crypto, Sports, Weather"), limit: z.number().int().min(1).max(12).optional() }),
    async run(a) {
      const which = a.list as gemini.Listing;
      const all = await gemini.listEvents(which, 20);
      const cat = String(a.category ?? "").toLowerCase();
      const events = all.filter((e) => !e.ticker.startsWith("CMB-") && (!cat || e.category.toLowerCase().includes(cat))).slice(0, Number(a.limit ?? 8));
      const data = events.map((e) => ({
        ticker: e.ticker,
        title: e.title,
        category: e.category,
        closes: e.expiry,
        contracts: e.contracts.slice(0, 6).map((c) => (which === "settled" ? { label: c.label, resolved: c.resolved ?? "pending" } : { symbol: c.symbol, label: c.label, bid: c.bid, ask: c.ask })),
      }));
      const word = which === "new" ? "newly listed" : which === "upcoming" ? "opening soon" : "just settled";
      return { data: { list: which, markets: data }, summary: `${events.length} markets ${word}${cat ? ` in ${a.category}` : ""}` };
    },
  },
  combo_quote: {
    description:
      "Price a combination: one contract paying $1 only if 2-6 different contracts ALL resolve as named. Returns each leg's price and the fair combined price.",
    params: z.object({ legs: z.array(z.object({ eventTicker: z.string(), symbol: z.string(), side: z.enum(["yes", "no"]) })).min(2).max(6) }),
    async run(a) {
      const venue = tradingVenue();
      const r = await comboLegs(a.legs as { eventTicker: string; symbol: string; side: "yes" | "no" }[], venue);
      if ("error" in r) throw new Error(r.error);
      const apart = r.apart;
      return {
        data: { venue: VENUE_NAME[venue], legs: r.legs.map((l) => ({ event: l.event, contract: l.label, needs: l.side, priceAlone: l.price, eventTicker: l.eventTicker, symbol: l.symbol })), fairPrice: r.fair, legsBoughtSeparately: apart, paysPerContract: 1, closes: r.closesAt, note: "fairPrice assumes the legs are independent; legs that tend to happen together are worth more than that." },
        summary: r.fair != null ? `${r.legs.length} outcomes together: about ${Math.round(r.fair * 100)}¢ per $1 of cover${apart != null ? ` (${Math.round(apart * 100)}¢ bought separately)` : ""}` : `${r.legs.length} outcomes together: no sellers on one leg, so no fair price yet`,
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
  find_nearby: {
    description: "Named places of one kind around a town or address, from OpenStreetMap: hotels to stay at, EV charging, fuel, or food. Use it for 'where can I stay/charge/eat in X'. It lists options (with websites when known); it doesn't check availability or prices and can't book.",
    params: z.object({ place: z.string().describe("Town or address"), what: z.enum(["hotel", "charging", "fuel", "food"]) }),
    async run(a) {
      const at = await geo.geocode(String(a.place));
      if (!at) return { data: { found: [] }, summary: `No match for “${a.place}”` };
      const found = await geo.nearby(at, a.what as geo.NearbyKind, 5);
      return { data: { near: at.name, found: found.map((x) => ({ name: x.name, where: x.where, website: x.website })) }, summary: found.length ? `${found.length} ${geo.NEARBY[a.what as geo.NearbyKind]} options near ${at.name}` : `Nothing listed near ${at.name}` };
    },
  },
  search_services: {
    description: `Find paid services on Circle's Agent Marketplace, with typed inputs/outputs. payableHere=true: a \`service\` step can buy it with its url and input; payable=true lists only those.`,
    params: z.object({ query: z.string(), category: z.enum(CATEGORIES).optional(), payable: z.boolean().optional() }),
    async run(a) {
      const q = String(a.query ?? "");
      const main = currentNet() === "mainnet";
      // The capability map once it has been crawled; the live keyword search until then.
      if (allCapabilities().length) {
        const hits = await searchCapabilities(q, { payable: a.payable ? (main ? "mainnet" : "now") : "any", limit: 8, among: a.category ? allCapabilities().filter((c) => c.category === a.category) : undefined });
        const data = hits.map(({ cap: c }) => {
          const r = reliability(c.resource);
          return {
            name: c.name,
            provider: c.provider,
            what: c.description.slice(0, 160),
            url: c.resource,
            method: c.method,
            input: c.inputs.map((x) => `${x.field} (${x.type}${x.required ? "" : ", optional"})`).join(", ") || undefined,
            priceUsd: c.priceUsd,
            payableHere: main ? c.payableMainnet : c.payableNow,
            networks: c.networks.slice(0, 4).map(networkName),
            inputs: c.inputs,
            outputs: c.outputs.map((o) => ({ path: o.path, type: o.type, label: o.label })),
            answers: c.answers,
            reliability: r.delivered + r.failed ? `${r.delivered} of ${r.delivered + r.failed} delivered` : "no runs yet",
          };
        });
        const here = data.filter((s) => s.payableHere).length;
        return { data, summary: `${data.length} marketplace services for “${q}” · ${here} payable now` };
      }
      const list = await searchServices(q, a.category as string | undefined, 6, Boolean(a.payable));
      const data = list.map((s) => ({ name: s.name, provider: s.provider, what: s.description, url: s.resource, method: s.method, input: s.input, priceUsd: s.priceUsd, payableHere: s.payableHere, networks: s.networks.slice(0, 4).map(networkName) }));
      const here = list.filter((s) => s.payableHere).length;
      return { data, summary: `${list.length} marketplace services for “${q}” · ${here} payable now` };
    },
  },
  read_arc: {
    description: "Read Arc testnet, free: what=balance (address), tx (hash: status, USDC moved), vault (address: funded, left, closed), payment (from+nonce: collected?). Only addresses/hashes you were given.",
    params: z.object({ what: z.enum(["balance", "tx", "vault", "payment"]), address: z.string().optional(), hash: z.string().optional(), from: z.string().optional(), nonce: z.string().optional() }),
    async run(a) {
      const q = checkQuestion(a);
      if ("error" in q) throw new Error(q.error);
      return readArc(q);
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
    description: `Chainlink oracle price read live from Ethereum mainnet, bought from Quicknode on Circle's Agent Marketplace (args: symbol, one of ${Object.keys(FEEDS).join("|")}; covers coins, gold and silver per ounce, and euro, pound and yen in dollars). An independent check on a price; can be used in a condition`,
    args: ["symbol"],
    key: (a) => `oracle:${a.symbol?.toLowerCase()}`,
    params: (a) => ({ symbol: a.symbol?.toLowerCase() }),
  },
  gas_price: {
    product: "onchain.gas",
    description: `What a transaction costs right now on a chain, read from Quicknode on Circle's Agent Marketplace (args: chain, one of ${Object.keys(EVM_CHAINS).join("|")})`,
    args: ["chain"],
    key: (a) => `onchain:gas:${a.chain?.toLowerCase()}`,
    params: (a) => ({ chain: a.chain?.toLowerCase() }),
  },
  btc_network: {
    product: "onchain.btc",
    description: "How busy Bitcoin is right now: the fee to confirm in about 3 blocks and how many payments are waiting, read from Quicknode on Circle's Agent Marketplace (no args)",
    args: [],
    key: () => "onchain:btc",
    params: () => ({}),
  },
  wallet_balance: {
    product: "onchain.balance",
    description: `USDC and native-coin balance of any wallet address, read from Quicknode on Circle's Agent Marketplace (args: chain, one of ${Object.keys(EVM_CHAINS).join("|")}; address, 0x…)`,
    args: ["chain", "address"],
    key: (a) => `onchain:balance:${a.chain?.toLowerCase()}:${a.address?.toLowerCase()}`,
    params: (a) => ({ chain: a.chain?.toLowerCase(), address: a.address }),
  },
  web_search: {
    product: "web.search",
    description: "Google search results with titles, links and snippets (args: query). Real USDC on Arc mainnet only",
    args: ["query"],
    key: (a) => `web:search:${a.query?.toLowerCase()}`,
    params: (a) => ({ query: a.query }),
  },
  news_search: {
    product: "web.news",
    description: "Recent news stories about a topic, company or person (args: query). Real USDC on Arc mainnet only",
    args: ["query"],
    key: (a) => `web:news:${a.query?.toLowerCase()}`,
    params: (a) => ({ query: a.query }),
  },
  place_reviews: {
    product: "web.reviews",
    description: "Finds a business on Google and reads its recent reviews with star ratings (args: place, name and city, e.g. 'Blue Bottle Coffee Oakland'). Real USDC on Arc mainnet only",
    args: ["place"],
    key: (a) => `web:reviews:${a.place?.toLowerCase()}`,
    params: (a) => ({ place: a.place }),
  },
  shopping_prices: {
    product: "web.shopping",
    description: "What stores charge for a product right now: lowest, typical and highest price (args: product, e.g. 'iPhone 15 128GB unlocked'). Real USDC on Arc mainnet only",
    args: ["product"],
    key: (a) => `web:shopping:${a.product?.toLowerCase()}`,
    params: (a) => ({ product: a.product }),
  },
  image_check: {
    product: "web.lens",
    description: "Reverse image search: whether a listing's photo appears elsewhere online, a sign it was copied (args: imageUrl, a public https link). Real USDC on Arc mainnet only",
    args: ["imageUrl"],
    key: (a) => `web:lens:${a.imageUrl}`,
    params: (a) => ({ imageUrl: a.imageUrl }),
  },
  phone_check: {
    product: "web.phone",
    description: "Whether a phone number is valid, and if it's an internet (VoIP) line, mobile or landline, with the carrier (args: phone, with country code). Real USDC on Arc mainnet only",
    args: ["phone"],
    key: (a) => `web:phone:${a.phone?.replace(/\D/g, "")}`,
    params: (a) => ({ phone: a.phone }),
  },
  company_record: {
    product: "web.company",
    description: "The company behind a website (Tomba): official phones and emails, founding year, how old its domain is, location, social accounts (args: site, a domain or link). Real USDC on Arc mainnet only",
    args: ["site"],
    key: (a) => `web:company:${a.site?.toLowerCase()}`,
    params: (a) => ({ site: a.site }),
  },
  read_listing: {
    product: "web.listing",
    description: "Read a marketplace listing (eBay, Facebook, Craigslist, a shop page) as fields: title, price, condition, seller, seller feedback and photo (args: url, the full listing link). Later steps can use its title, price and photo. Real USDC on Arc mainnet only",
    args: ["url"],
    key: (a) => `web:listing:${a.url}`,
    params: (a) => ({ url: a.url }),
  },
  read_page: {
    product: "web.page",
    description: "Read a public web page as text (MrScraper): title, headings and its opening text (args: url, a full https link). Real USDC on Arc mainnet only",
    args: ["url"],
    key: (a) => `web:page:${a.url}`,
    params: (a) => ({ url: a.url }),
  },
  market_odds: {
    product: "web.odds",
    description: "What Polymarket and Kalshi price for the same question, as a second opinion on Gemini's odds (args: query, 1-3 words like 'bitcoin' or 'fed'). Real USDC on Arc mainnet only",
    args: ["query"],
    key: (a) => `web:odds:${a.query?.toLowerCase()}`,
    params: (a) => ({ query: a.query }),
  },
  service: {
    product: "marketplace.service",
    description: "One paid request to a payableHere service from search_services (args: url as listed; input, a JSON string: query fields for GET, the body for POST, or {\"method\",\"params\"} for JSON-RPC; what, 3-6 words). Code reads the seller's price and payee. Reads only",
    args: ["url"],
    key: (a) => `service:${a.url}:${a.input ?? ""}`,
    params: (a) => ({ url: a.url, input: a.input ?? "{}" }),
  },
  drive_route: {
    product: "routes.drive",
    description: "Driving route through ordered stops with distance and hours per leg (args: stops, full place names with state or country joined by |)",
    args: ["stops"],
    key: (a) => `route:${a.stops}`,
    params: (a) => ({ stops: a.stops }),
  },
};

/** What a lookup costs: the vendor's price for marketplace tools, our own feed's price otherwise. */
export const researchPrice = (tool: string, args: Record<string, string> = {}) => (isVendorTool(tool) ? VENDOR_TOOLS[tool].price(args) : PRODUCTS[RESEARCH[tool].product].price);
export const isMarketplace = isVendorTool;
/** Most one marketplace request may cost, in USDC base units. */
export const MAX_SERVICE = BigInt(process.env.MARKETPLACE_MAX_PER_REQUEST ?? 10_000);

/** Each agent's own harness: what it can look up for free, what it can buy, and what it can do. */
export const TOOLKIT: Record<AgentId, { free: string[]; research: string[] }> = {
  inso: { free: ["search_markets", "get_market", "browse_markets", "combo_quote", "my_positions", "spot_price", "search_services", "read_arc"], research: ["odds_history", "trade_tape", "oracle_price", "news_search", "web_search", "market_odds", "read_page", "read_listing", "service"] },
  trado: { free: ["spot_price", "search_markets", "get_market", "browse_markets", "my_positions", "search_services", "read_arc"], research: ["spot_candles", "oracle_price", "odds_history", "gas_price", "btc_network", "wallet_balance", "service"] },
  // The trip agent can look at markets too, so a brief about a trip can name the fuel cover Inso would build.
  worko: { free: ["find_place", "find_nearby", "search_markets", "my_positions", "search_services", "read_arc"], research: ["drive_route", "oracle_price", "web_search", "news_search", "place_reviews", "shopping_prices", "image_check", "phone_check", "company_record", "read_page", "read_listing", "market_odds", "service"] },
};

export const researchMenu = (agent?: AgentId) =>
  Object.entries(RESEARCH)
    .filter(([id]) => !agent || TOOLKIT[agent].research.includes(id))
    .map(([id, t]) => `- ${id}: ${t.description} · ${id === "service" ? "priced by the seller" : `${(Number(researchPrice(id)) / 1e6).toFixed(4)} USDC`}`)
    .join("\n");

/** What each agent may propose to do. */
export const ACTIONS: Record<AgentId, MoveAction["kind"][]> = {
  inso: ["prediction_order"],
  trado: ["spot_order", "prediction_order"],
  worko: ["itinerary"],
};

// ---------- proposal schema (shared by the built-in agent and outside AIs over MCP) ----------

export const ProposalInput = z.object({
  title: z.string().min(3).max(60).describe("Short name for the move, e.g. 'Buy YES: Dallas wins'"),
  why: z.string().max(240).describe("One or two sentences: why this move, based on what you found"),
  ask: z.string().max(160).describe("The yes/no question for the user, e.g. 'Buy 10 YES at 55¢ or less if the odds are still under 60%?'"),
  research: z
    .array(z.object({ tool: z.enum(Object.keys(RESEARCH) as [string, ...string[]]), args: z.record(z.string(), z.string()), label: z.string().max(50), why: z.string().max(100) }))
    .max(8)
    .describe("Paid lookups to run before acting (up to 8; the job's spending cap still applies). Empty if the free data already settles it."),
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
        combo: z
          .array(z.object({ eventTicker: z.string(), symbol: z.string(), side: z.enum(["yes", "no"]) }))
          .min(2)
          .max(6)
          .nullable()
          .optional()
          .describe("One order that pays only if EVERY leg resolves as its side says (legs from combo_quote). With it: eventTicker and symbol 'COMBO', side yes, orderType limit."),
      }),
      z.object({ kind: z.literal("spot_order"), symbol: z.string(), side: z.enum(["buy", "sell"]), limitPrice: z.number().positive(), amountUsd: z.number().min(1).max(100) }),
      z.object({ kind: z.literal("itinerary"), stops: z.array(z.string().min(2).max(60)).min(2).max(6).describe("Full place names with state or country, e.g. 'Santa Fe, New Mexico'"), hoursPerDay: z.number().int().min(2).max(12).describe("Most hours of driving a day: the user's number; 6 if they didn't say"), lookFor: z.enum(["hotel", "charging"]).nullable().optional().describe("What to list where each day ends: hotel (default) or charging for an electric car") }),
    ])
    .nullable()
    .describe("The concrete move. null for research only."),
  condition: z
    .object({ metric: z.enum(["yes_price", "no_price", "spot_price", "oracle_price"]), symbol: z.string(), op: z.enum(["<=", ">="]), value: z.number() })
    .nullable()
    .describe("A check on a DIFFERENT number than the order's own price, read right before placing (e.g. only buy the BTC-above-66k contract if BTC spot ≥ 64k). The order's own price target goes in orderType/maxPrice/stopPrice, not here. null for none."),
  alsoRequire: z
    .array(z.object({ metric: z.enum(["yes_price", "no_price", "spot_price", "oracle_price"]), symbol: z.string(), op: z.enum(["<=", ">="]), value: z.number() }))
    .max(2)
    .nullable()
    .optional()
    .describe("More checks that must ALL hold with `condition` ('only if A and B', e.g. Chainlink and Gemini spot BTC both ≥ 64k). Same rules."),
  budgetUsd: z.number().positive().nullable().describe("The most the user said they'd spend on this order in USD, if they said; enforced."),
  hedge: z
    .object({ protects: z.string().max(80).describe("What the user stands to lose, in their words: 'a pricier Uber if it's freezing Saturday'"), lossUsd: z.number().positive().max(1000).describe("The EXTRA cost they would face if it happens, in USD: what a fuel spike adds to the trip, not the whole fuel bill. Usually a fraction of the bill") })
    .nullable()
    .optional()
    .describe("Set when the order is insurance (the user loses money if an event happens; buy the side that pays then). Code sizes it to cover lossUsd or fit budgetUsd. prediction_order buys only."),
});
export type ProposalInput = z.infer<typeof ProposalInput>;

/**
 * A proposal built by code (the composer, a learned recipe): the same move, plus chains between
 * steps. Never offered to the model as a schema; the model's own moves use ProposalInput.
 */
const Ref = z.string().regex(/^\$(given\.[A-Za-z0-9_]+|[A-Za-z][A-Za-z0-9_-]*(\..*)?)$/);
export const ComposedInput = ProposalInput.extend({
  research: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/).optional(),
        tool: z.enum(Object.keys(RESEARCH) as [string, ...string[]]),
        args: z.record(z.string(), z.string()),
        label: z.string().max(60),
        why: z.string().max(140),
        bind: z.record(z.string().regex(/^[A-Za-z0-9_.-]+$/), Ref).optional(),
        when: z.object({ ref: Ref, op: z.enum(["exists", "missing", "==", "!=", ">=", "<=", "contains"]), value: z.union([z.string(), z.number(), z.boolean()]).optional() }).optional(),
        verify: z.object({ group: z.string().max(40), path: z.string().max(120), kind: z.enum(["same", "close"]), tolerance: z.number().min(0).max(1).optional() }).optional(),
        onConflict: z.string().max(40).optional(),
        resource: z.string().optional(),
        lane: z.string().max(40).optional(),
      }),
    )
    .max(8),
  givens: z.record(z.string().regex(/^[A-Za-z0-9_]+$/), z.object({ type: z.string(), value: z.string().max(500) })).optional(),
  compose: z.any().optional(),
  tier: z.enum(["quick", "thorough", "certain"]).optional(),
  gaps: z.array(z.object({ fact: z.string(), why: z.string() })).optional(),
  then: z
    .object({ watch: z.object({ ref: Ref, op: z.enum(["<=", ">=", "==", "!=", "changed"]), value: z.union([z.string(), z.number()]).optional(), every: z.enum(["15m", "1h", "6h", "1d"]), days: z.number().int().min(1).max(30), title: z.string().max(80), says: z.string().max(160) }) })
    .optional(),
});

import { limits } from "./settings";
import { mainnetOn } from "@/lib/network";
import { askOf, plainWords, titleOf } from "@/lib/plain";
import type { Brief } from "@/lib/types";
const round2 = (x: number) => Math.round(x * 100) / 100;
/** An order needs time to rest; refuse contracts closing sooner than this. */
const MIN_EXPIRY_MS = Number(process.env.MIN_ORDER_EXPIRY_MIN ?? 20) * 60_000;

/**
 * Checks a move against the exchange it would trade on and the user's limits.
 * Fixes what's safe to fix (rounding, budget) and says so; refuses the rest with a reason the model can act on.
 */
export async function validateProposal(agent: AgentId, input: unknown, id: string, opts: { composed?: boolean } = {}): Promise<{ proposal: Proposal } | { error: string }> {
  const parsed = (opts.composed ? ComposedInput : ProposalInput).safeParse(input);
  if (!parsed.success) return { error: `Invalid move: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  const p = parsed.data as z.infer<typeof ComposedInput>;
  if (!opts.composed && p.research.length > 8) return { error: "At most 8 paid lookups in one job. Split the rest into a second job, or drop the least useful one." };
  const venue = tradingVenue();
  const adjustments: string[] = [];
  let eventContracts: string[] = [];
  let market: Proposal["market"];
  const budget = p.budgetUsd ?? undefined;
  let action: MoveAction | undefined;
  const raw = p.action ?? undefined;
  if (raw && !ACTIONS[agent].includes(raw.kind)) return { error: `This agent can't do ${raw.kind}. Allowed: ${ACTIONS[agent].join(", ")}` };
  if (!raw && p.research.length === 0) return { error: "A move needs an action or at least one paid lookup" };

  if (raw?.kind === "prediction_order" && raw.combo?.length) {
    const built = await checkCombo(raw, venue, budget, p.hedge);
    if ("error" in built) return built;
    action = built.action;
    adjustments.push(...built.notes);
    eventContracts = built.action.kind === "prediction_order" ? (built.action.combo?.legs.map((l) => l.symbol) ?? []) : [];
    market = { ask: null, bid: null, closesAt: built.closesAt };
  } else if (raw?.kind === "prediction_order") {
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
    // A post-only line takes only orders that wait: keep the limit just under the cheapest seller so it rests.
    const restAt = c.postOnly && c.ask != null && raw.trade !== "sell" ? round2(Math.max(0.01, c.ask - 0.01)) : undefined;
    if (restAt != null && raw.maxPrice > restAt) adjustments.push(`Gemini only takes orders that wait on this line right now, so yours rests at ${Math.round(restAt * 100)}¢ until a seller comes down to it`);
    const maxPrice = round2(restAt != null ? Math.min(raw.maxPrice, restAt) : raw.maxPrice);
    let quantity = raw.quantity;
    // A hedge is sized by code: enough contracts that the payout, after their cost, covers the loss.
    if (p.hedge && raw.trade !== "sell") {
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
    action = { kind: "prediction_order", eventTicker: raw.eventTicker, symbol: raw.symbol, label: raw.label, event: ev.title, side: raw.side, orderType: raw.orderType, maxPrice, stopPrice, quantity };
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
    // A field filled from an earlier step's answer ("bind") is known only when the job runs.
    const bound = (x: string) => Boolean((r as { bind?: Record<string, string> }).bind?.[x]);
    const missing = t.args.filter((x) => x !== "tf" && !r.args[x] && !bound(x));
    if (missing.length) return { error: `${r.tool} needs ${missing.join(", ")}` };
    // Checks that only take real USDC on Arc mainnet can't run on a test-money job.
    const nets = isVendorTool(r.tool) ? VENDOR_TOOLS[r.tool].nets : undefined;
    if (nets && !nets.includes(currentNet())) return { error: `“${r.label}” is paid with real USDC on Arc mainnet, so it can't run on a practice or testnet job. Switch the job to mainnet, or drop that step.` };
    if (r.tool === "image_check" && !bound("imageUrl") && !/^https:\/\//.test(r.args.imageUrl ?? "")) return { error: "The photo check needs a public https link to the photo" };
    if (r.tool === "phone_check" && !bound("phone") && (r.args.phone ?? "").replace(/\D/g, "").length < 7) return { error: "The phone check needs a full phone number with its country code" };
    // Paid lookups read live Gemini data. Don't charge the user for a symbol that has none.
    if (r.tool === "odds_history" || r.tool === "trade_tape") {
      const known = await gemini.recentTrades(r.args.symbol, 1).then(() => true, () => false);
      if (!known) return { error: `${r.args.symbol} has no live market data to buy${venue === "gemini-sandbox" ? " (test-exchange-only contracts have none; research the live market with the same strike, or drop the research)" : ""}` };
    }
    if (r.tool === "spot_candles") {
      const list = await spotSymbols().catch(() => [] as string[]);
      if (list.length && !list.includes(r.args.symbol?.toLowerCase())) return { error: `Unknown spot symbol ${r.args.symbol}` };
    }
    if ((r.tool === "gas_price" || r.tool === "wallet_balance") && !EVM_CHAINS[r.args.chain?.toLowerCase()]) return { error: `${r.tool}: unknown chain ${r.args.chain}. Known: ${Object.keys(EVM_CHAINS).join(", ")}` };
    if (r.tool === "wallet_balance" && !isAddress(r.args.address ?? "")) return { error: "wallet_balance needs a full wallet address (0x followed by 40 hex characters). Ask the user for it; never make one up." };
    if (r.tool === "service") {
      // The model names the listing; price, payee and method come from the marketplace and the seller, never from the model.
      const listing = await findService(r.args.url).catch(() => undefined);
      if (!listing) return { error: `${r.args.url} isn't a marketplace service payable on this network. Use a url from search_services with payableHere=true, or tell the user it needs mainnet.` };
      // Only services that read: one that sends, buys, books or changes something is never planned.
      const who = listing.name.toLowerCase().startsWith(listing.provider.toLowerCase()) ? listing.name : `${listing.provider} ${listing.name}`;
      if (getCapability(listing.resource)?.readOnly === false) return { error: `${who} sends, buys or changes something instead of looking it up, and Agento only pays for answers. Tell the user it exists and that they'd do that part themselves.` };
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(r.args.input || "{}");
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("not an object");
      } catch {
        return { error: "service: input must be a JSON object written as a string" };
      }
      let q: { amount: bigint; payTo: string };
      try {
        q = await quoteService(listing, input);
      } catch (e) {
        // A step whose input arrives from an earlier answer can't be quoted whole yet: it is priced
        // from its marketplace listing, and the seller's own quote is checked against that when it runs.
        const bound = "bind" in r && r.bind && Object.keys(r.bind).length > 0;
        if (!bound || !listing.amount || !listing.payTo) return { error: `Couldn't get a price from ${listing.provider}: ${(e as Error).message.slice(0, 140)}` };
        q = { amount: BigInt(listing.amount), payTo: listing.payTo };
      }
      if (q.amount > MAX_SERVICE) return { error: `${listing.provider} asks ${Number(q.amount) / 1e6} USDC for this request, above the ${Number(MAX_SERVICE) / 1e6} USDC per-request limit` };
      r.args = { url: listing.resource, input: JSON.stringify(input), what: (r.args.what || listing.description || listing.name).slice(0, 60), provider: listing.provider, price: q.amount.toString(), payTo: q.payTo };
      r.resource = listing.resource;
    }
  }

  // Every check must be something the app can read right before placing. One on the order's own
  // price adds nothing (the exchange enforces the limit and the order keeps resting), so it's folded in.
  const checks: MoveCondition[] = [];
  for (const raw of [p.condition, ...(p.alsoRequire ?? [])]) {
    if (!raw) continue;
    let c = raw as MoveCondition;
    if (c.metric === "oracle_price") {
      const sym = c.symbol.toLowerCase();
      if (!p.research.some((r) => r.tool === "oracle_price" && r.args.symbol?.toLowerCase() === sym))
        return { error: `An oracle_price condition needs an oracle_price research step for ${sym}, so the price is bought right before the check` };
      c = { ...c, symbol: sym };
    } else if (c.metric === "spot_price") {
      const list = await spotSymbols().catch(() => [] as string[]);
      if (list.length && !list.includes(c.symbol.toLowerCase())) return { error: `Condition uses unknown spot symbol ${c.symbol}` };
      c = { ...c, symbol: c.symbol.toLowerCase() };
    } else if (!eventContracts.includes(c.symbol)) return { error: "A price condition must be on a contract in the same event as the order, or on a spot price (spot_price)" };
    if (action?.kind === "prediction_order" && c.symbol === action.symbol && c.metric !== "spot_price") {
      adjustments.push("Price check folded into the order: it rests on the exchange until the price is right");
      continue;
    }
    if (action?.kind === "spot_order" && c.metric === "spot_price" && c.symbol === action.symbol) {
      adjustments.push("Price check folded into the limit order");
      continue;
    }
    // Saying the same thing twice isn't a second check.
    if (!checks.some((x) => x.metric === c.metric && x.symbol === c.symbol && x.op === c.op)) checks.push(c);
  }
  const condition: MoveCondition | undefined = checks[0];
  const also = checks.slice(1);
  // The same lookup twice is the same data paid for twice: keep one. A step that read from the
  // dropped copy reads from the kept one instead.
  const seen = new Map<string, string>();
  const sameAs = new Map<string, string>();
  const unique = p.research.filter((r, i) => {
    const oldId = r.id ?? `r${i + 1}`;
    const bound = r.bind ? JSON.stringify(Object.entries(r.bind).sort()) : "";
    const k = `${r.tool}:${JSON.stringify(Object.fromEntries(Object.entries(r.args).map(([a, v]) => [a, String(v).toLowerCase()]).sort()))}:${bound}`;
    const kept = seen.get(k);
    if (kept && !r.verify && !r.onConflict && !r.when) {
      adjustments.push(`Already includes ${r.label}; not buying it twice`);
      sameAs.set(oldId, kept);
      return false;
    }
    seen.set(k, oldId);
    return true;
  });
  if (venue === "gemini-sandbox" && action && action.kind !== "itinerary" && unique.some((r) => r.tool !== "oracle_price"))
    adjustments.push("Data from the live Gemini market; the order trades on Gemini's test exchange, where prices can differ");
  const newId = new Map<string, string>();
  unique.forEach((r) => newId.set(r.id ?? `r${p.research.indexOf(r) + 1}`, `r${unique.indexOf(r) + 1}`));
  for (const [dropped, kept] of sameAs) newId.set(dropped, newId.get(kept)!);
  const givens = p.givens ?? {};
  // Chains only read backwards: from what the user gave, or from a step that comes earlier.
  const reref = (ref: string, at: number): string | { error: string } => {
    const g = /^\$given\.(.+)$/.exec(ref);
    if (g) return givens[g[1]] ? ref : { error: `A step reads ${ref}, which the user didn't give` };
    const m = /^\$([A-Za-z][A-Za-z0-9_-]*)(\..*)?$/.exec(ref);
    const to = m && newId.get(m[1]);
    if (!m || !to) return { error: `A step reads ${ref}, which isn't a step in this move` };
    if (Number(to.slice(1)) >= at + 1) return { error: `Step ${at + 1} reads from step ${to.slice(1)}, which runs later` };
    return `$${to}${m[2] ?? ""}`;
  };
  const research: ResearchStep[] = [];
  for (const [i, r] of unique.entries()) {
    const step: ResearchStep = { id: `r${i + 1}`, tool: r.tool, args: r.args, label: r.label, why: r.why };
    if (r.bind) {
      const cap = r.tool === "service" ? getCapability(r.args.url) : undefined;
      step.bind = {};
      for (const [field, ref] of Object.entries(r.bind)) {
        if (cap?.inputs.length && !cap.inputs.some((x) => x.field === field)) return { error: `${cap.provider} doesn't take a field called ${field}` };
        const to = reref(ref, i);
        if (typeof to !== "string") return to;
        step.bind[field] = to;
      }
    }
    if (r.when) {
      const to = reref(r.when.ref, i);
      if (typeof to !== "string") return to;
      step.when = { ...r.when, ref: to };
    }
    if (r.verify) step.verify = r.verify;
    if (r.onConflict) step.onConflict = r.onConflict;
    if (r.resource) step.resource = r.resource;
    if (r.lane) step.lane = r.lane;
    research.push(step);
  }
  // The keep-watching stage reads from a step too: rename it like the others.
  let then: Proposal["then"];
  if (opts.composed && p.then?.watch) {
    const to = reref(p.then.watch.ref, unique.length);
    if (typeof to !== "string") return to;
    then = { watch: { ...p.then.watch, ref: to } };
  }
  for (const r of research.filter((x) => x.onConflict)) {
    const members = research.filter((x) => x.verify?.group === r.onConflict);
    if (members.length < 2) return { error: `The tie-breaker ${r.label} needs two steps that answer the same thing (group ${r.onConflict})` };
    if (Number(r.id.slice(1)) < Math.max(...members.map((m) => Number(m.id.slice(1))))) return { error: `The tie-breaker ${r.label} must come after the steps it settles` };
  }
  return {
    proposal: {
      id,
      // The name and the question are written by code from the checked move, in everyday words, so their numbers are always the real ones.
      title: titleOf({ action, hedge: hedgeOf(p.hedge, action), title: p.title }),
      why: plainWords(p.why),
      ask: action ? askOf({ action, hedge: hedgeOf(p.hedge, action), ask: p.ask }) : p.ask,
      research,
      action,
      condition,
      also: also.length ? also : undefined,
      venue: action && action.kind !== "itinerary" ? venue : "paper",
      budgetUsd: budget,
      hedge: hedgeOf(p.hedge, action),
      market,
      adjustments: adjustments.length ? adjustments : undefined,
      ...(opts.composed
        ? {
            givens: Object.keys(givens).length ? givens : undefined,
            compose: p.compose as Proposal["compose"],
            tier: p.tier,
            gaps: p.gaps?.length ? p.gaps : undefined,
            then,
          }
        : {}),
    },
  };
}

/** A stored move in the shape the model writes and the validator reads. */
/** Cost and payout of a hedge, from the order as it will actually be placed. */
function hedgeOf(h: ProposalInput["hedge"], a: MoveAction | undefined): Proposal["hedge"] {
  if (!h || a?.kind !== "prediction_order" || a.trade === "sell") return undefined;
  return {
    covered: Math.min(h.lossUsd, round2(a.quantity * (1 - a.maxPrice))), protects: h.protects, lossUsd: h.lossUsd, cost: round2(a.maxPrice * a.quantity), payout: a.quantity };
}

type RawPrediction = Extract<NonNullable<ProposalInput["action"]>, { kind: "prediction_order" }>;

/** Reads each leg of a combination from the exchange it would trade on, with what that outcome costs alone. */
export async function comboLegs(legs: { eventTicker: string; symbol: string; side: "yes" | "no" }[], venue: Proposal["venue"]) {
  const r = await gemini.comboLegs(legs, marketBase(venue), MIN_EXPIRY_MS);
  return "error" in r && /not found/.test(r.error) && venue === "gemini-sandbox" ? { error: `${r.error} on ${VENUE_NAME[venue]}; use contracts from search_markets' "tradable" list` } : r;
}

async function checkCombo(raw: RawPrediction, venue: Proposal["venue"], budget: number | undefined, hedge: ProposalInput["hedge"]): Promise<{ action: MoveAction; notes: string[]; closesAt?: string } | { error: string }> {
  if (raw.trade === "sell") return { error: "A combination can only be bought here. To get out of one, sell it from my_positions like any other contract." };
  if (raw.orderType !== "limit") return { error: "A combination is a plain limit order: set orderType limit." };
  if (raw.side !== "yes") return { error: "Buy the YES side of a combination; say what each leg needs with that leg's own side." };
  if (venue === "gemini") return { error: "Gemini hasn't switched on combinations on its real exchange yet; they work on the test exchange and in practice." };
  const read = await comboLegs(raw.combo ?? [], venue);
  if ("error" in read) return read;
  const notes: string[] = [];
  const maxPrice = round2(raw.maxPrice);
  let quantity = raw.quantity;
  if (hedge) {
    const need = Math.min(500, Math.max(1, Math.ceil(hedge.lossUsd / (1 - maxPrice) - 1e-9)));
    const fits = Math.max(1, Math.floor(limits().maxOrderUsd / maxPrice));
    const sized = Math.min(need, fits);
    if (sized !== quantity) notes.push(sized < need ? `Sized to ${sized} contracts, the most your $${limits().maxOrderUsd} order limit allows` : `Sized to ${sized} contracts so the payout covers your $${hedge.lossUsd}`);
    quantity = sized;
  }
  if (budget != null && maxPrice * quantity > budget + 1e-9) {
    quantity = Math.floor(budget / maxPrice + 1e-9);
    if (quantity < 1) return { error: `Budget $${budget} can't buy one combined contract at ${Math.round(maxPrice * 100)}¢` };
    notes.push(`Quantity cut to ${quantity} to stay within your $${budget}`);
  }
  if (maxPrice * quantity > limits().maxOrderUsd) return { error: `Order over the user's $${limits().maxOrderUsd} per-order limit (set in Settings). Make it smaller.` };
  const apart = read.apart;
  notes.push(`Pays $1 a contract only if all ${read.legs.length} happen; nothing if any one doesn't`);
  if (read.fair != null) notes.push(`Worth about ${Math.round(read.fair * 100)}¢ if the legs move independently${apart != null ? `; the legs bought separately cost ${Math.round(apart * 100)}¢` : ""}`);
  if (read.fair != null && maxPrice > Math.min(0.99, read.fair * 1.5 + 0.02)) notes.push(`Your limit of ${Math.round(maxPrice * 100)}¢ is well above that; a lower limit risks less`);
  notes.push(venue === "paper" ? "Practice: the combination is priced from the live markets but not created" : "A new combination starts with an empty book, so the order waits for a seller");
  const label = read.legs.map((l) => `${l.label}${l.side === "no" ? " (NO)" : ""}`).join(" + ").slice(0, 60);
  return { action: { kind: "prediction_order", eventTicker: "COMBO", symbol: "COMBO", label, side: "yes", orderType: "limit", maxPrice, quantity, combo: { legs: read.legs, fair: read.fair } }, notes, closesAt: read.closesAt };
}

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

/** A move built from several services, whose steps pass answers to each other. */
export const isComposed = (p: Proposal) => Boolean(p.compose || p.givens || p.research.some((r) => r.bind || r.when || r.verify || r.onConflict));

/** What an editor may change in a composed move: its steps with their links; the rest is put back after. */
export const ComposedEditInput = ComposedInput.omit({ givens: true, compose: true, tier: true, gaps: true });

/** A composed move as input again, keeping each step's id and what it reads from. */
export function toComposedInput(p: Proposal): z.infer<typeof ComposedInput> {
  return {
    ...toProposalInput(p),
    research: p.research.map((r) => ({ id: r.id, tool: r.tool, args: r.args, label: r.label, why: r.why, bind: r.bind, when: r.when, verify: r.verify, onConflict: r.onConflict, resource: r.resource, lane: r.lane })),
    then: p.then,
    givens: p.givens,
    compose: p.compose,
    tier: p.tier,
    gaps: p.gaps,
  } as z.infer<typeof ComposedInput>;
}

export function toProposalInput(p: Proposal): ProposalInput {
  const a = p.action;
  return {
    title: p.title,
    why: p.why,
    ask: p.ask,
    research: p.research.map((r) => ({ tool: r.tool, args: r.args, label: r.label, why: r.why })),
    action: !a ? null : a.kind === "prediction_order" ? { ...a, trade: a.trade ?? null, stopPrice: a.stopPrice ?? null, combo: a.combo ? a.combo.legs.map((l) => ({ eventTicker: l.eventTicker, symbol: l.symbol, side: l.side })) : null } : a,
    condition: p.condition ?? null,
    alsoRequire: p.also?.length ? p.also : null,
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

// ---------- plans: the task broken into steps, each done by the agent that fits ----------

export const PlanInput = z.object({
  title: z.string().max(70),
  why: z.string().max(240).describe("One or two sentences: how the steps fit together"),
  steps: z
    .array(
      z.object({
        // Trado stays valid for plans built by code; the AI is told to use only Inso and Worko.
        agent: z.enum(["inso", "trado", "worko"]).describe("inso: prediction-market orders, hedges and sells. worko: research, drives and checks before paying. Use only these two."),
        brief: z.string().min(8).max(260).describe("What this agent should do, complete on its own: name the market, coin, places and amounts. That agent builds the move with its own tools; it never sees this conversation."),
        after: z.array(z.number().int().min(1).max(12)).max(6).describe("Numbers of the earlier steps this one must wait for. Empty when it doesn't depend on any: independent steps run at the same time."),
        gate: z.enum(["done", "filled"]).describe("done: start once the steps in `after` finish. filled: only once their orders have actually filled."),
        usesFindings: z.boolean().optional().describe("true when what this step does depends on what the steps in `after` FIND (e.g. 'buy whichever coin fell more'): it is rebuilt from their results when it starts."),
        useProceeds: z.boolean().describe("true when this step should spend what the sell it waits for brought in; its budget is set to that amount when it starts. Needs gate filled."),
      }),
    )
    .max(12),
  understood: z.string().max(170).nullable().optional().describe("Set for a PROBLEM (they said what worries them, not what to do): the problem in one sentence. Then `drivers` is required and 0-12 steps are fine."),
  drivers: z
    .array(
      z.object({
        what: z.string().max(50).describe("One thing driving the problem, in a few words"),
        help: z.enum(["now", "partly", "mainnet", "no"]).describe("now/partly: a step here handles it. mainnet: a real service does this but takes mainnet. no: nothing here helps."),
        how: z.string().max(150).describe("What the step does about it; or the service that would; or why nothing can"),
        step: z.number().int().min(1).max(12).nullable().optional().describe("Number of the step that handles it (now/partly only)"),
      }),
    )
    .max(5)
    .nullable()
    .optional(),
  leftOpen: z.string().max(160).nullable().optional().describe("What stays uncovered even after every step"),
  unavailable: z
    .array(z.object({ what: z.string().max(80), why: z.string().max(160) }))
    .max(4)
    .describe("Parts of the request no agent can do here, e.g. booking a hotel (travel booking services on Circle's marketplace take Arc mainnet only). Empty if everything is covered."),
});
export type PlanInput = z.infer<typeof PlanInput>;

/** Turns a brief into a checked move, by the agent that will run it. */
export type BuildStep = (agent: AgentId, brief: string, id: string) => Promise<{ proposal: Proposal } | { error: string }>;

const placesOrder = (p: Proposal) => Boolean(p.action && p.action.kind !== "itinerary");
const isSell = (p: Proposal) => (p.action?.kind === "prediction_order" && p.action.trade === "sell") || (p.action?.kind === "spot_order" && p.action.side === "sell");

/** The rules a plan's shape must follow, whoever built its steps. */
export function checkPlanShape(steps: Pick<PlanStep, "id" | "after" | "gate" | "useProceeds" | "proposal">[]): string | null {
  for (const [i, s] of steps.entries()) {
    const n = i + 1;
    const deps = s.after.map((id) => steps.find((x) => x.id === id));
    if (deps.some((d) => !d) || s.after.some((id) => Number(id.slice(1)) >= n)) return `Step ${n} can only wait for steps before it`;
    if (s.gate === "filled" && !s.after.length) return `Step ${n} waits for an order to fill but names no step in \`after\``;
    // A fill gate needs an order to wait on; steps without one (lookups, routes) just have to finish.
    if (s.gate === "filled" && !deps.some((d) => placesOrder(d!.proposal))) return `Step ${n} waits for an order to fill, but nothing it waits for places an order. Use gate done.`;
    if (s.useProceeds && (s.gate !== "filled" || deps.filter((d) => isSell(d!.proposal)).length !== 1)) return `Step ${n} spends proceeds, so it must wait (gate filled) for exactly one step that sells something`;
  }
  return null;
}

/** Every step is built by its own agent from the brief, then the plan's shape is checked. */
export async function validatePlan(input: unknown, id: string, build: BuildStep): Promise<{ plan?: Plan; proposal?: Proposal; brief?: Brief } | { error: string }> {
  const parsed = PlanInput.safeParse(input);
  if (!parsed.success) return { error: `Invalid plan: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  const p = parsed.data;
  const drivers = p.understood ? (p.drivers ?? []) : [];
  if (p.understood && drivers.length < 1) return { error: "`understood` needs `drivers`: the things behind the problem, each with how much of it can be handled" };
  if (!p.understood && p.steps.length < 2) return { error: "A plan needs at least 2 steps. For one thing, use propose_move." };
  for (const d of drivers) {
    const handled = d.help === "now" || d.help === "partly";
    if (handled && (d.step == null || d.step > p.steps.length)) return { error: `"${d.what}" is marked ${d.help}, so it needs \`step\`: the number of the step that handles it. If no step does, mark it mainnet or no.` };
    if (!handled && d.step != null) return { error: `"${d.what}" is marked ${d.help} but points at a step. Either a step handles it (now/partly) or none does.` };
    // With mainnet on, "needs mainnet" is no longer a reason: the service can be bought, so it becomes a step.
    if (d.help === "mainnet" && onMainnet()) return { error: `Mainnet is on, so "${d.what}" can be done now: find the service with search_services and make it a step, or mark it no with the real reason.` };
  }
  const brief: Brief | undefined = p.understood
    ? { understood: p.understood, drivers: drivers.map((d) => ({ what: d.what, help: d.help, how: d.how, step: d.step != null ? `s${d.step}` : undefined })), leftOpen: p.leftOpen ?? undefined }
    : undefined;
  if (brief && !p.steps.length) return { brief };
  // Each agent works its own step. A few at a time, so a long plan doesn't flood the model.
  const built: Awaited<ReturnType<BuildStep>>[] = new Array(p.steps.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, p.steps.length) }, async () => {
      for (let i = next++; i < p.steps.length; i = next++) built[i] = await build(p.steps[i].agent, p.steps[i].brief, `${id}-s${i + 1}`);
    }),
  );
  const failed = built.map((b, i) => ("error" in b ? `Step ${i + 1} (${p.steps[i].agent}): ${b.error}` : null)).filter(Boolean);
  if (failed.length) return { error: failed.join(" | ") };
  const steps: PlanStep[] = p.steps.map((s, i) => ({
    id: `s${i + 1}`,
    agent: s.agent,
    proposal: (built[i] as { proposal: Proposal }).proposal,
    after: [...new Set(s.after)].sort().map((n) => `s${n}`),
    gate: s.gate,
    brief: s.brief,
    useProceeds: s.useProceeds || undefined,
    usesFindings: (s.usesFindings && s.after.length > 0) || undefined,
    status: "waiting",
  }));
  const wrong = checkPlanShape(steps);
  if (wrong) return { error: wrong };
  // One step is just a move; the brief still says how it fits the problem.
  if (brief && steps.length === 1) return { proposal: steps[0].proposal, brief };
  return { plan: { id, title: p.title, why: p.why, steps, unavailable: p.unavailable, status: "proposed" }, brief };
}
