import type { ComboLeg } from "@/lib/types";

const BASE = process.env.GEMINI_API_BASE ?? "https://api.gemini.com";

export interface MarketContract {
  symbol: string;
  label: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  expiry?: string;
  /** Contract is active and its book is open for trading. */
  open?: boolean;
  /** Only resting orders are taken right now: an order waits on the book instead of filling at once. */
  postOnly?: boolean;
  /** The exchange's own id for the contract, used to name it as a leg of a combination. */
  contractId?: string;
  /** How it resolved, once settled. */
  resolved?: "yes" | "no";
  /** The level the contract is about ("$64,500 or above" → 64500), when it has one. */
  strike?: number;
}

export interface MarketEvent {
  ticker: string;
  title: string;
  category: string;
  volume: number;
  contracts: MarketContract[];
  status?: string;
  /** The price index the event settles against, e.g. LS-LRRR-XBTUSD. */
  source?: string;
  createdAt?: string;
  expiry?: string;
}

export interface OddsPoint {
  t: number;
  p: number;
}

const ALIASES: Record<string, string> = {
  bitcoin: "BTC",
  btc: "BTC",
  ethereum: "ETH",
  ether: "ETH",
  eth: "ETH",
  solana: "SOL",
  sol: "SOL",
  hype: "HYPE",
  hyperliquid: "HYPE",
  gold: "Gold",
  silver: "Silver",
  oil: "Oil",
};

const STOP = new Set(["the", "and", "for", "how", "what", "will", "odds", "market", "markets", "track", "price", "today", "this", "week", "with", "moved", "move", "show", "find", "give", "about", "have", "been", "does", "doing", "into", "from", "they", "that", "whats", "going", "moving", "trend", "trending", "latest", "right", "now"]);

export const SANDBOX_BASE = "https://api.sandbox.gemini.com";
export const PROD_BASE = BASE;

/** A lookup failed in a way the user can't fix by rephrasing: the exchange is slow or down. */
export class MarketDataDown extends Error {}

async function get<T>(path: string, empty?: T, base = BASE): Promise<T> {
  // Gemini's public API answers 5xx or 429 now and then; two quick retries cover almost all of them.
  let res: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`${base}${path}`, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(12_000) }).catch(() => undefined);
    if (res && res.status < 500 && res.status !== 429) break;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  if (!res || res.status >= 500 || res.status === 429) throw new MarketDataDown("Gemini's market data isn't answering right now");
  if (!res.ok) {
    if (empty !== undefined && res.status === 400) {
      const body = (await res.json().catch(() => ({}))) as { reason?: string };
      if (body.reason === "NoDataFound") return empty;
    }
    throw new Error(`gemini ${res.status} ${path}`);
  }
  return res.json() as Promise<T>;
}

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

/** Turns free text into Gemini search terms. Known assets win over plain words. */
export function searchTerms(task: string): string[] {
  const words = task.toLowerCase().match(/[a-z]+/g) ?? [];
  const known = [...new Set(words.map((w) => ALIASES[w]).filter(Boolean))];
  if (known.length) return known.slice(0, 3);
  return [...new Set(words.filter((w) => w.length > 3 && !STOP.has(w)))].slice(0, 2);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toEvent = (e: any): MarketEvent => ({
  ticker: e.ticker,
  title: e.title,
  category: e.category,
  volume: Number(e.volume ?? 0),
  status: e.status,
  source: e.source,
  createdAt: e.createdAt,
  expiry: e.expiryDate,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contracts: (e.contracts ?? []).map((c: any) => ({
    symbol: c.instrumentSymbol,
    label: c.label,
    last: num(c.prices?.lastTradePrice),
    bid: num(c.prices?.bestBid),
    ask: num(c.prices?.bestAsk),
    expiry: c.expiryDate,
    // "post_only": Gemini takes only orders that wait on the book for now. Still tradable, just not at once.
    open: (c.status ?? "active") === "active" && ["open", "post_only"].includes(c.marketState ?? "open"),
    postOnly: c.marketState === "post_only" || undefined,
    contractId: typeof c.id === "string" ? c.id.split("-").pop() : undefined,
    resolved: c.resolutionSide === "yes" || c.resolutionSide === "no" ? c.resolutionSide : undefined,
    strike: c.strike?.value != null && Number.isFinite(Number(c.strike.value)) ? Number(c.strike.value) : undefined,
  })),
});

/** What one outcome of a contract costs to buy right now: YES at the ask, NO at 1 − the YES bid. */
export const buyPrice = (c: Pick<MarketContract, "bid" | "ask">, side: "yes" | "no") => (side === "yes" ? c.ask : c.bid != null ? Math.round((1 - c.bid) * 100) / 100 : null);

export type LegAsk = { eventTicker: string; symbol: string; side: "yes" | "no" };

/**
 * Reads each leg of a combination (2-6 different contracts that must all resolve as named) with
 * what that outcome costs alone, and the fair price of the lot: the legs' prices multiplied.
 */
export async function comboLegs(legs: LegAsk[], base = BASE, minLeftMs = 0): Promise<{ legs: ComboLeg[]; fair: number | null; apart: number | null; closesAt?: string } | { error: string }> {
  if (legs.length < 2 || legs.length > 6) return { error: "A combination takes 2 to 6 legs" };
  if (new Set(legs.map((l) => l.symbol)).size !== legs.length) return { error: "Each leg of a combination must be a different contract" };
  const out: ComboLeg[] = [];
  for (const l of legs) {
    const ev = await getEvent(l.eventTicker, base).catch(() => null);
    const c = ev?.contracts.find((x) => x.symbol === l.symbol);
    if (!ev || !c) return { error: `Leg ${l.symbol} not found in event ${l.eventTicker}` };
    if (c.open === false) return { error: `${c.label} (${ev.title}) isn't open for trading right now` };
    const left = c.expiry ? Date.parse(c.expiry) - Date.now() : Infinity;
    if (left < minLeftMs) return { error: `${c.label} (${ev.title}) closes too soon for an order to rest. Pick a later contract.` };
    out.push({ eventTicker: ev.ticker, symbol: c.symbol, label: c.label, event: ev.title, side: l.side, price: buyPrice(c, l.side), contractId: c.contractId, expiry: c.expiry });
  }
  // Two answers to one question can't both be YES, unless they are rungs of a ladder ("$64k or above" and "$65k or above").
  for (const a of out)
    for (const b of out)
      if (a !== b && a.eventTicker === b.eventTicker && a.side === "yes" && b.side === "yes" && !/above|below/i.test(`${a.label} ${b.label}`))
        return { error: `${a.label} and ${b.label} are answers to the same question (${a.event}), so both can't be YES. Pick legs from different questions.` };
  const priced = out.every((l) => l.price != null);
  const cents2 = (x: number) => Math.round(x * 100) / 100;
  const fair = priced ? Math.max(0.01, cents2(out.reduce((x, l) => x * (l.price as number), 1))) : null;
  const apart = priced ? cents2(out.reduce((x, l) => x + (l.price as number), 0)) : null;
  const ends = out.map((l) => (l.expiry ? Date.parse(l.expiry) : NaN)).filter(Number.isFinite);
  return { legs: out, fair, apart, closesAt: ends.length ? new Date(Math.max(...ends)).toISOString() : undefined };
}

export type Listing = "new" | "upcoming" | "settled";
const LISTING_PATH: Record<Listing, string> = { new: "newly-listed", upcoming: "upcoming", settled: "recently-settled" };

/** What just opened, what opens soon, and what just resolved (Gemini's discovery lists). */
export async function listEvents(which: Listing, limit = 8, base = BASE): Promise<MarketEvent[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await get<{ data: any[] }>(`/v1/prediction-markets/events/${LISTING_PATH[which]}?limit=${Math.min(Math.max(1, limit), 20)}`, { data: [] }, base);
  return (r.data ?? []).map(toEvent);
}

/** The spot symbol behind a settlement index: LS-LRRR-XBTUSD → btcusd. */
export function spotOfSource(source?: string): string | undefined {
  const m = source?.match(/^LS-LRRR-([A-Z0-9]+?)USD$/);
  if (!m) return undefined;
  const coin = m[1] === "XBT" ? "BTC" : m[1] === "SOLN" ? "SOL" : m[1].replace(/\d+$/, "");
  return `${coin.toLowerCase()}usd`;
}

/** Every open market whose name matches, up to 50: for finding one market the paged list skipped. */
export async function namedEvents(query: string, base = BASE): Promise<MarketEvent[]> {
  const q = new URLSearchParams({ status: "active", limit: "50", search: query });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await get<{ data: any[] }>(`/v1/prediction-markets/events?${q}`, { data: [] }, base).catch(() => ({ data: [] }));
  return (r.data ?? []).map(toEvent);
}

export async function searchEvents(query: string, limit = 5, base = BASE): Promise<MarketEvent[]> {
  // Gemini refuses larger pages on search.
  const q = new URLSearchParams({ status: "active", limit: String(Math.min(Math.max(1, limit), 6)) });
  if (query) q.set("search", query);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await get<{ data: any[] }>(`/v1/prediction-markets/events?${q}`, undefined, base);
  return r.data.map(toEvent);
}

/**
 * Search that copes with how people ask. Gemini matches the whole phrase, so "NYC temperature"
 * finds nothing; when that happens each word is searched and events matching more words come first.
 */
export async function findEvents(query: string, limit = 6, base = BASE): Promise<MarketEvent[]> {
  const whole = await searchEvents(query, limit, base);
  const words = [...new Set(query.split(/\s+/).map((w) => w.replace(/[^\w$%.-]/g, "")).filter((w) => w.length > 1 && !STOP.has(w.toLowerCase())))];
  if (whole.length || words.length < 2) return whole;
  const lists = await Promise.all(words.slice(0, 3).map((w) => searchEvents(ALIASES[w.toLowerCase()] ?? w, 6, base).catch(() => [] as MarketEvent[])));
  const score = new Map<string, { e: MarketEvent; n: number }>();
  for (const list of lists)
    for (const e of list) {
      const hit = score.get(e.ticker) ?? { e, n: 0 };
      hit.n++;
      score.set(e.ticker, hit);
    }
  // A word can also match inside a title the other word's search returned ("NYC" in a temperature market).
  for (const hit of score.values()) hit.n += words.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(hit.e.title)).length;
  return [...score.values()].sort((a, b) => b.n - a.n || b.e.volume - a.e.volume).slice(0, limit).map((x) => x.e);
}

const activeCache = new Map<string, { at: number; list: Promise<MarketEvent[]> }>();
/** Every open event on a venue (all pages), kept for a minute: the job catalog reads it for each card. */
export function activeEvents(base = BASE): Promise<MarketEvent[]> {
  const hit = activeCache.get(base);
  if (hit && Date.now() - hit.at < 60_000) return hit.list;
  // Gemini lists about a thousand open markets, 200 a page, college games first: read every page, or
  // the Fed decision and month-end price lines are never seen.
  const page = (offset: number) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get<{ data: any[]; pagination?: { total?: number } }>(`/v1/prediction-markets/events?status=active&limit=200&offset=${offset}`, { data: [] }, base);
  const list = page(0).then(async (first) => {
    const total = Math.min(first.pagination?.total ?? 0, 2000);
    const rest = await Promise.all(Array.from({ length: Math.max(0, Math.ceil(total / 200) - 1) }, (_, i) => page((i + 1) * 200).catch(() => ({ data: [] }))));
    // Pages can overlap (Gemini's order shifts between calls), so keep each market once.
    const seen = new Set<string>();
    return [first, ...rest].flatMap((r) => r.data ?? []).filter((e) => !seen.has(e.ticker) && seen.add(e.ticker)).map(toEvent);
  });
  activeCache.set(base, { at: Date.now(), list });
  list.catch(() => activeCache.delete(base));
  return list;
}

export async function getEvent(ticker: string, base = BASE): Promise<MarketEvent> {
  return toEvent(await get(`/v1/prediction-markets/events/${encodeURIComponent(ticker)}`, undefined, base));
}

type Candle = [number, number, number, number, number, number];

/** YES-probability candles, oldest first. Falls back to the trade tape when a contract has no candles. */
export async function oddsHistory(symbol: string, tf: "1m" | "5m" | "15m" | "1hr" = "15m"): Promise<OddsPoint[]> {
  const rows = await get<Candle[]>(`/v2/candles/${encodeURIComponent(symbol)}/${tf}`, []);
  if (rows.length) return rows.map(([t, , , , c]) => ({ t, p: c })).sort((a, b) => a.t - b.t);
  const trades = await recentTrades(symbol, 200);
  return trades.map((x) => ({ t: x.t, p: x.p })).sort((a, b) => a.t - b.t);
}

export async function recentTrades(symbol: string, limit = 50) {
  const rows = await get<{ timestampms: number; price: string; amount: string; type: string }[]>(
    `/v1/trades/${encodeURIComponent(symbol)}?limit_trades=${limit}`,
    [],
  );
  return rows.map((r) => ({ t: r.timestampms, p: Number(r.price), size: Number(r.amount), side: r.type }));
}

/** Spot candles for the trading agent. */
export async function spotCandles(symbol: string, tf: "15m" | "1hr" | "6hr" | "1day" = "1hr"): Promise<OddsPoint[]> {
  const rows = await get<Candle[]>(`/v2/candles/${encodeURIComponent(symbol)}/${tf}`);
  return rows.map(([t, , , , c]) => ({ t, p: c })).sort((a, b) => a.t - b.t);
}

export interface SpotQuote {
  symbol: string;
  last: number;
  bid: number | null;
  ask: number | null;
  change24h: number | null;
  high24h: number | null;
  low24h: number | null;
}

/** Latest spot price and 24h range. */
export async function spotTicker(symbol: string, base = BASE): Promise<SpotQuote> {
  const t = await get<{ close: string; open: string; high: string; low: string; bid?: string; ask?: string }>(`/v2/ticker/${encodeURIComponent(symbol)}`, undefined, base);
  const last = Number(t.close);
  const open = Number(t.open);
  return { symbol, last, bid: num(t.bid), ask: num(t.ask), change24h: open ? last / open - 1 : null, high24h: num(t.high), low24h: num(t.low) };
}
