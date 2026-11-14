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

const STOP = new Set(["the", "and", "for", "how", "what", "will", "odds", "market", "markets", "track", "price", "today", "this", "week", "with", "moved", "move", "show", "find", "give", "about"]);

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`gemini ${res.status} ${path}`);
  return res.json() as Promise<T>;
}

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

/** Turns free text into Gemini search terms. */
export function searchTerms(task: string): string[] {
  const words = task.toLowerCase().match(/[a-z]+/g) ?? [];
  const terms: string[] = [];
  for (const w of words) {
    const t = ALIASES[w] ?? (w.length > 3 && !STOP.has(w) ? w : null);
    if (t && !terms.includes(t)) terms.push(t);
  }
  return terms.slice(0, 3);
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

/** YES-probability candles, oldest first. */
export async function oddsHistory(symbol: string, tf: "1m" | "5m" | "15m" | "1hr" = "15m"): Promise<OddsPoint[]> {
  const rows = await get<[number, number, number, number, number, number][]>(`/v2/candles/${encodeURIComponent(symbol)}/${tf}`);
  return rows.map(([t, , , , c]) => ({ t, p: c })).sort((a, b) => a.t - b.t);
}

export async function recentTrades(symbol: string, limit = 50) {
  const rows = await get<{ timestampms: number; price: string; amount: string; type: string }[]>(
    `/v1/trades/${encodeURIComponent(symbol)}?limit_trades=${limit}`,
  );
  return rows.map((r) => ({ t: r.timestampms, p: Number(r.price), size: Number(r.amount), side: r.type }));
}

/** Spot candles for the trading agent. */
export async function spotCandles(symbol: string, tf: "15m" | "1hr" | "6hr" | "1day" = "1hr"): Promise<OddsPoint[]> {
  return oddsHistory(symbol, tf as "15m");
}
