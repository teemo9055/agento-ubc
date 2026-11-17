import * as gemini from "./gemini";

/**
 * Live prices for the contracts on screen.
 * Gemini's WebSocket (`{symbol}@bookTicker`) pushes the best bid and ask as they change; where the
 * socket can't be reached (some hosts block WebSocket upgrades) the same numbers are read from the
 * REST API every few seconds instead. Either way the browser gets one stream of ticks.
 */
export interface Tick {
  symbol: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  /** Set once the contract has settled. */
  resolved?: "yes" | "no";
  /** The level the contract is about, and the price it is measured against right now. */
  strike?: number;
  spot?: number;
  spotSymbol?: string;
  closesAt?: string;
  via: "stream" | "poll";
  at: number;
}

export interface Watch {
  eventTicker: string;
  symbol: string;
}

const WS_URL = process.env.GEMINI_WS_URL ?? "wss://ws.gemini.com";
const POLL_MS = Number(process.env.LIVE_POLL_MS ?? 4000);
const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

// ---------- the stream ----------

type Book = { bid: number | null; ask: number | null; last: number | null; at: number };
const books = new Map<string, Book>();
const wanted = new Map<string, number>();
const listeners = new Set<(symbol: string) => void>();
let sock: WebSocket | null = null;
let sockReady = false;
let retryAt = 0;
let fails = 0;
let nextId = 1;

/** Reads one stream frame into the book it belongs to. Exported for the test. */
export function applyFrame(raw: string): string | undefined {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw);
  } catch {
    return undefined;
  }
  // Book ticker frames carry no event name: they are recognised by their fields.
  if (typeof m.s !== "string" || (!("b" in m) && !("a" in m))) return undefined;
  const prev = books.get(m.s);
  books.set(m.s, { bid: num(m.b), ask: num(m.a), last: num(m.c) ?? prev?.last ?? null, at: Date.now() });
  return m.s;
}

function send(method: "SUBSCRIBE" | "UNSUBSCRIBE", symbols: string[]) {
  if (!sock || !sockReady || !symbols.length) return;
  try {
    sock.send(JSON.stringify({ id: String(nextId++), method, params: symbols.map((s) => `${s}@bookTicker`) }));
  } catch {
    /* the close handler reconnects */
  }
}

function connect() {
  if (sock || process.env.LIVE_STREAM === "off" || process.env.MARKET_DATA === "replay" || typeof WebSocket === "undefined") return;
  if (Date.now() < retryAt || !wanted.size) return;
  try {
    const ws = new WebSocket(WS_URL);
    sock = ws;
    ws.onopen = () => {
      sockReady = true;
      fails = 0;
      send("SUBSCRIBE", [...wanted.keys()]);
    };
    ws.onmessage = (e) => {
      const s = applyFrame(String(e.data));
      if (s) for (const l of listeners) l(s);
    };
    const down = () => {
      if (sock !== ws) return;
      sock = null;
      sockReady = false;
      fails++;
      // Back off up to five minutes, so a host that can't reach the socket isn't asked over and over.
      retryAt = Date.now() + Math.min(300_000, 5_000 * 2 ** Math.min(fails, 6));
    };
    ws.onclose = down;
    ws.onerror = down;
  } catch {
    sock = null;
    fails++;
    retryAt = Date.now() + 60_000;
  }
}

function want(symbol: string) {
  wanted.set(symbol, (wanted.get(symbol) ?? 0) + 1);
  if (wanted.get(symbol) === 1) send("SUBSCRIBE", [symbol]);
  connect();
}

function unwant(symbol: string) {
  const n = (wanted.get(symbol) ?? 1) - 1;
  if (n > 0) return void wanted.set(symbol, n);
  wanted.delete(symbol);
  books.delete(symbol);
  send("UNSUBSCRIBE", [symbol]);
  if (!wanted.size && sock) {
    try {
      sock.close();
    } catch {
      /* already closed */
    }
    sock = null;
    sockReady = false;
  }
}

export const streamUp = () => sockReady;

// ---------- reads shared by everyone watching the same market ----------

const cache = new Map<string, { at: number; v: Promise<unknown> }>();
function shared<T>(key: string, ms: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.v as Promise<T>;
  const v = load();
  cache.set(key, { at: Date.now(), v });
  if (cache.size > 200) for (const [k, c] of cache) if (Date.now() - c.at > 60_000) cache.delete(k);
  return v;
}

/** One reading of every watched contract. The stream's book wins when it is fresh. */
export async function snapshot(watches: Watch[], base?: string): Promise<Tick[]> {
  const events = [...new Set(watches.map((w) => w.eventTicker))];
  const read = await Promise.all(events.map((t) => shared(`ev:${base ?? ""}:${t}`, POLL_MS - 500, () => gemini.getEvent(t, base)).catch(() => null)));
  const byTicker = new Map(events.map((t, i) => [t, read[i]]));
  const spots = new Map<string, number>();
  await Promise.all(
    [...new Set(read.map((e) => gemini.spotOfSource(e?.source)).filter((s): s is string => Boolean(s)))].map(async (s) => {
      const q = await shared(`spot:${s}`, POLL_MS - 500, () => gemini.spotTicker(s)).catch(() => null);
      if (q) spots.set(s, q.last);
    }),
  );
  const out: Tick[] = [];
  for (const w of watches) {
    const ev = byTicker.get(w.eventTicker);
    const c = ev?.contracts.find((x) => x.symbol === w.symbol);
    if (!ev || !c) continue;
    const live = sockReady ? books.get(w.symbol) : undefined;
    const fresh = live && Date.now() - live.at < 30_000 ? live : undefined;
    const spotSymbol = gemini.spotOfSource(ev.source);
    out.push({
      symbol: w.symbol,
      bid: fresh ? fresh.bid : c.bid,
      ask: fresh ? fresh.ask : c.ask,
      last: fresh?.last ?? c.last,
      resolved: c.resolved,
      strike: c.strike,
      spot: spotSymbol ? spots.get(spotSymbol) : undefined,
      spotSymbol,
      closesAt: c.expiry,
      via: fresh ? "stream" : "poll",
      at: Date.now(),
    });
  }
  return out;
}

/**
 * Follows the given contracts until `stop` is called: a reading right away, then one whenever
 * the stream reports a change, and at least every few seconds.
 */
export function follow(watches: Watch[], base: string | undefined, onTicks: (ticks: Tick[]) => void): () => void {
  let stopped = false;
  let last = "";
  let busy = false;
  let again = false;
  const symbols = new Set(watches.map((w) => w.symbol));
  // Only the live exchange has a public stream; a test exchange's books are read by polling.
  const streamed = !base || base === gemini.PROD_BASE;
  const push = async () => {
    if (stopped) return;
    if (busy) return void (again = true);
    busy = true;
    try {
      const ticks = await snapshot(watches, base);
      const key = JSON.stringify(ticks.map((t) => [t.symbol, t.bid, t.ask, t.last, t.resolved, t.spot, t.via]));
      if (key !== last && !stopped) {
        last = key;
        onTicks(ticks);
      }
    } catch {
      /* the next reading tries again */
    } finally {
      busy = false;
      if (again) {
        again = false;
        void push();
      }
    }
  };
  const onStream = (s: string) => symbols.has(s) && void push();
  if (streamed) {
    for (const s of symbols) want(s);
    listeners.add(onStream);
  }
  void push();
  const timer = setInterval(() => {
    if (streamed) connect();
    void push();
  }, POLL_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
    if (streamed) {
      listeners.delete(onStream);
      for (const s of symbols) unwant(s);
    }
  };
}
