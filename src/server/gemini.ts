const BASE = process.env.GEMINI_API_BASE ?? "https://api.gemini.com";

export interface MarketContract {
  symbol: string;
  label: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  expiry?: string;
}

export interface MarketEvent {
  ticker: string;
  title: string;
  category: string;
  volume: number;
  contracts: MarketContract[];
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

async function get<T>(path: string, empty?: T): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" }, cache: "no-store" });
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contracts: (e.contracts ?? []).map((c: any) => ({
    symbol: c.instrumentSymbol,
    label: c.label,
    last: num(c.prices?.lastTradePrice),
    bid: num(c.prices?.bestBid),
    ask: num(c.prices?.bestAsk),
    expiry: c.expiryDate,
  })),
});

export async function searchEvents(query: string, limit = 5): Promise<MarketEvent[]> {
  const q = new URLSearchParams({ status: "active", limit: String(limit) });
  if (query) q.set("search", query);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await get<{ data: any[] }>(`/v1/prediction-markets/events?${q}`);
  return r.data.map(toEvent);
}

export async function getEvent(ticker: string): Promise<MarketEvent> {
  return toEvent(await get(`/v1/prediction-markets/events/${encodeURIComponent(ticker)}`));
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
