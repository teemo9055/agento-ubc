import { createHmac, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { MoveAction, OrderResult, Venue } from "@/lib/types";
import * as gemini from "./gemini";
import { PROD_BASE, SANDBOX_BASE } from "./gemini";

/**
 * Gemini exchange client for the moves users approve.
 * - gemini-sandbox (default when its key is set): Gemini's test exchange, real order flow, test funds.
 * - gemini: real money, only for jobs that choose it (or GEMINI_DEFAULT_VENUE=gemini).
 * - paper: no keys; nothing is sent and every result says "simulation".
 * Keys sign each request locally (HMAC-SHA384), so they stay in the server env.
 * Endpoints follow developer.gemini.com (Prediction Markets REST + spot order API).
 */
const PROD = process.env.GEMINI_TRADING_ENV === "production";

/**
 * Keys per venue: GEMINI_SANDBOX_KEY/SECRET for the test exchange, GEMINI_LIVE_KEY/SECRET for real
 * money. The older single GEMINI_TRADING_KEY/SECRET still works: it is the sandbox key, or the live
 * one when GEMINI_TRADING_ENV=production.
 */
function creds(v: Venue): { key: string; secret: string; base: string } | null {
  const pick = (a?: string, b?: string) => (a && b ? { key: a, secret: b } : null);
  if (v === "gemini-sandbox") {
    const c = pick(process.env.GEMINI_SANDBOX_KEY, process.env.GEMINI_SANDBOX_SECRET) ?? (!PROD ? pick(process.env.GEMINI_TRADING_KEY, process.env.GEMINI_TRADING_SECRET) : null);
    return c && { ...c, base: SANDBOX_BASE };
  }
  if (v === "gemini") {
    const c = pick(process.env.GEMINI_LIVE_KEY, process.env.GEMINI_LIVE_SECRET) ?? (PROD ? pick(process.env.GEMINI_TRADING_KEY, process.env.GEMINI_TRADING_SECRET) : null);
    return c && { ...c, base: PROD_BASE };
  }
  return null;
}

/** Whether orders can go to a venue on this server. Practice always can. */
export const venueReady = (v: Venue) => v === "paper" || Boolean(creds(v));
/** Every venue this server can send orders to, safest first. */
export const venues = (): Venue[] => (["paper", "gemini-sandbox", "gemini"] as Venue[]).filter(venueReady);

/** Real money is never the default unless the owner says so (GEMINI_DEFAULT_VENUE=gemini, or the old production setting with only a live key). */
function defaultVenue(): Venue {
  const want = process.env.GEMINI_DEFAULT_VENUE as Venue | undefined;
  if (want && venueReady(want)) return want;
  if (venueReady("gemini-sandbox")) return "gemini-sandbox";
  if (PROD && venueReady("gemini")) return "gemini";
  return "paper";
}

const venueStore = new AsyncLocalStorage<Venue>();
/** Where this job's orders go: the job's own choice when it has one, else the server's default. */
export const tradingVenue = (): Venue => {
  const v = venueStore.getStore();
  return v && venueReady(v) ? v : defaultVenue();
};
/** Runs `fn` with orders going to `v` (falls back to the default if `v` isn't connected). */
export const withVenue = <T>(v: Venue | undefined, fn: () => T): T => venueStore.run(v && venueReady(v) ? v : defaultVenue(), fn);
export const VENUE_NAME: Record<Venue, string> = { "gemini-sandbox": "Gemini sandbox", gemini: "Gemini", paper: "Practice" };
export const VENUE_NOTE: Record<Venue, string> = {
  "gemini-sandbox": "Gemini's test exchange: real orders, test money",
  gemini: "Real money on Gemini",
  paper: "Practice: no exchange is connected, so no real order is sent",
};
/** Where tradable markets and their order books live for a venue. */
export const marketBase = (v: Venue = tradingVenue()) => (v === "gemini-sandbox" ? SANDBOX_BASE : PROD_BASE);
const tradeBase = () => creds(tradingVenue())?.base ?? marketBase(tradingVenue());

export class ExchangeError extends Error {
  constructor(
    message: string,
    public code: "terms" | "rejected" | "auth" | "unavailable" = "rejected",
  ) {
    super(message);
  }
}

let lastNonce = 0;
async function priv<T = Record<string, unknown>>(path: string, body: Record<string, unknown> = {}, method: "POST" | "GET" = "POST"): Promise<T> {
  const c = creds(tradingVenue());
  if (!c) throw new ExchangeError("No exchange connected", "auth");
  const KEY = c.key;
  const SECRET = c.secret;
  // Nonces must increase per key, even for calls in the same millisecond.
  lastNonce = Math.max(Date.now(), lastNonce + 1);
  const payload = Buffer.from(JSON.stringify({ request: path, nonce: lastNonce, ...body })).toString("base64");
  const signature = createHmac("sha384", SECRET).update(payload).digest("hex");
  const res = await fetch(`${tradeBase()}${path}`, {
    method,
    headers: { "content-type": "text/plain", "x-gemini-apikey": KEY, "x-gemini-payload": payload, "x-gemini-signature": signature, "cache-control": "no-cache" },
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.result === "error") {
    const msg = String(json.message ?? json.error ?? json.reason ?? `HTTP ${res.status}`);
    throw new ExchangeError(msg.slice(0, 200), res.status === 401 || res.status === 403 ? "auth" : "rejected");
  }
  return json as T;
}

// ---------- account ----------

export interface TradingStatus {
  venue: Venue;
  connected: boolean;
  note: string;
  termsAccepted?: boolean;
  usdAvailable?: number;
  error?: string;
}

export async function tradingStatus(): Promise<TradingStatus> {
  const venue = tradingVenue();
  const base = { venue, note: VENUE_NOTE[venue] };
  if (venue === "paper") return { ...base, connected: false };
  try {
    const [terms, balances] = await Promise.all([
      priv<{ hasAcceptedLatest: boolean }>("/v1/prediction-markets/terms/status", {}, "GET"),
      priv<{ currency: string; available: string }[]>("/v1/balances").catch(() => [] as { currency: string; available: string }[]),
    ]);
    const usd = Array.isArray(balances) ? balances.find((b) => b.currency === "USD") : undefined;
    return { ...base, connected: true, termsAccepted: terms.hasAcceptedLatest, usdAvailable: usd ? Number(usd.available) : undefined };
  } catch (e) {
    return { ...base, connected: false, error: (e as Error).message };
  }
}

export interface CheckStep {
  step: string;
  ok: boolean;
  detail: string;
}

/**
 * Test exchange only: proves the whole order path works with the user's keys. Places one
 * 1-contract YES order at 1¢ (far from any seller, so it can't fill), finds it, cancels it.
 */
export async function selfTest(): Promise<CheckStep[]> {
  const out: CheckStep[] = [];
  const add = (step: string, ok: boolean, detail: string) => (out.push({ step, ok, detail }), ok);
  if (tradingVenue() !== "gemini-sandbox") {
    add("Test exchange", false, tradingVenue() === "paper" ? "No Gemini keys set, so orders are simulated" : "Only runs on the test exchange, never with real money");
    return out;
  }
  const st = await tradingStatus();
  if (!add("Keys", st.connected, st.connected ? "Signed in to the Gemini test exchange" : `Gemini refused the keys: ${st.error}`)) return out;
  if (!add("Terms", Boolean(st.termsAccepted), st.termsAccepted ? "Prediction-market terms accepted" : "Accept the terms above first")) return out;
  add("Balance", (st.usdAvailable ?? 0) > 0, st.usdAvailable != null ? `$${st.usdAvailable.toFixed(2)} USD available` : "Couldn't read the balance (the key may lack the Fund Manager role; orders still work)");
  const held = await positions().then(
    (p) => add("Positions", true, `${p.positions.length} open position${p.positions.length === 1 ? "" : "s"}`),
    (e) => add("Positions", false, (e as Error).message.slice(0, 120)),
  );
  void held;
  const events = await gemini.searchEvents("BTC", 6, SANDBOX_BASE).catch(() => []);
  const c = events.flatMap((e) => e.contracts.filter((x) => x.open !== false && (!x.expiry || Date.parse(x.expiry) - Date.now() > 60 * 60_000)).map((x) => ({ e, x })))[0];
  if (!add("Market", Boolean(c), c ? `Using ${c.e.title} · ${c.x.label}` : "No open BTC contract on the test exchange right now")) return out;
  let orderId: number | undefined;
  try {
    const r = await priv<{ orderId: number; status: string }>("/v1/prediction-markets/order", { symbol: c.x.symbol, orderType: "limit", side: "buy", outcome: "yes", quantity: "1", price: "0.01", timeInForce: "good-til-cancel" });
    orderId = r.orderId;
    add("Place", true, `Order ${r.orderId} resting at 1¢ (${r.status})`);
  } catch (e) {
    add("Place", false, (e as Error).message.slice(0, 160));
    return out;
  }
  try {
    await priv("/v1/prediction-markets/order/cancel", { orderId });
    const still = (await priv<{ orders: { orderId: number }[] }>("/v1/prediction-markets/orders/active", { symbol: c.x.symbol, limit: 100 })).orders.some((o) => o.orderId === orderId);
    add("Cancel", !still, still ? `Order ${orderId} is still open: cancel it on Gemini` : "Cancelled; nothing left open");
  } catch (e) {
    add("Cancel", false, `${(e as Error).message.slice(0, 120)}. Cancel order ${orderId} on Gemini.`);
  }
  return out;
}

/** Only on the user's explicit click: accepting terms is their decision. */
export async function acceptTerms() {
  return priv<{ success: boolean }>("/v1/prediction-markets/terms/accept");
}

// ---------- orders ----------

/** Most the order can cost, in USD. */
let feeCache: { at: number; bps: { maker: number; taker: number } } | undefined;
/**
 * The account's own spot fee rates, from Gemini (basis points). Simulation charges nothing.
 * If the account can't be read, assumes a conservative 0.4% so the budget still holds.
 */
export async function spotFeeBps(): Promise<{ maker: number; taker: number }> {
  if (tradingVenue() === "paper") return { maker: 0, taker: 0 };
  if (feeCache && Date.now() - feeCache.at < 3_600_000) return feeCache.bps;
  const r = await priv<{ api_maker_fee_bps?: number; api_taker_fee_bps?: number }>("/v1/notionalvolume").catch(() => null);
  const bps = { maker: Number(r?.api_maker_fee_bps ?? 40), taker: Number(r?.api_taker_fee_bps ?? 40) };
  feeCache = { at: Date.now(), bps };
  return bps;
}

/** What the move can spend. Selling spends nothing: it returns money. */
export const notionalOf = (a: MoveAction) => (a.kind === "prediction_order" ? (a.trade === "sell" ? 0 : a.maxPrice * a.quantity) : a.kind === "spot_order" ? a.amountUsd : 0);

const cents = (x: number) => `${Math.round(x * 100)}¢`;
export function describeAction(a: MoveAction) {
  if (a.kind === "prediction_order" && a.combo) return `${a.quantity} × all of: ${a.combo.legs.map((l) => `${l.label}${l.side === "no" ? " (NO)" : ""}`).join(" + ")}, at ≤ ${cents(a.maxPrice)}`;
  if (a.kind === "prediction_order")
    return a.orderType === "stop-limit"
      ? a.trade === "sell"
        ? `Sell ${a.quantity} × ${a.side.toUpperCase()} “${a.label}” at ≥ ${cents(a.maxPrice)}`
        : `${a.quantity} × ${a.side.toUpperCase()} “${a.label}” once it rises to ${cents(a.stopPrice ?? a.maxPrice)}, paying ≤ ${cents(a.maxPrice)}`
      : `${a.quantity} × ${a.side.toUpperCase()} “${a.label}” at ≤ ${cents(a.maxPrice)}`;
  if (a.kind === "spot_order") return `${a.side === "buy" ? "Buy" : "Sell"} $${a.amountUsd} of ${a.symbol.replace(/usd$/, "").toUpperCase()} at ${a.side === "buy" ? "≤" : "≥"} $${a.limitPrice}`;
  return `Itinerary: ${a.stops.join(" → ")}`;
}

const now = () => new Date().toISOString();

/**
 * An order this job already placed, found on the exchange. Gemini's docs: on a timeout,
 * check active orders before retrying, because the first request may have gone through.
 */
async function alreadyPlaced(action: Extract<MoveAction, { kind: "prediction_order" }>, since: number) {
  const active = await priv<{ orders: (PmOrder & { price: string; outcome: string; side: string; createdAt: string })[] }>("/v1/prediction-markets/orders/active", { symbol: action.symbol, limit: 100 });
  return active.orders.find(
    (o) =>
      o.side === (action.trade ?? "buy") &&
      o.outcome === action.side &&
      Number(o.price) === action.maxPrice &&
      Number(o.quantity) === action.quantity &&
      Date.parse(o.createdAt) >= since - 5_000,
  );
}

/** Symbol rules for spot orders: price and size steps, minimum size. */
async function spotRules(symbol: string) {
  const r = await fetch(`${tradeBase()}/v1/symbols/details/${encodeURIComponent(symbol)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new ExchangeError(`Unknown symbol ${symbol}`);
  const d = (await r.json()) as { tick_size: number; quote_increment: number; min_order_size: string; status: string };
  return { tick: Number(d.tick_size), quoteStep: Number(d.quote_increment), min: Number(d.min_order_size), open: d.status === "open" };
}

const stepDown = (x: number, step: number) => {
  const decimals = Math.max(0, Math.round(-Math.log10(step)));
  return (Math.floor(x / step + 1e-9) * step).toFixed(decimals);
};

/** Places the approved order. `since` = when this job's order step began, for duplicate detection on retry. */
export async function placeOrder(action: MoveAction, since = Date.now()): Promise<OrderResult> {
  const venue = tradingVenue();
  const notional = notionalOf(action);
  const detail = describeAction(action);
  if (action.kind === "itinerary") return { venue: "paper", status: "simulated", detail, notional: 0 };
  if (venue === "paper") return { venue, status: "simulated", detail: `Practice only: ${detail}`, orderId: `sim-${randomUUID().slice(0, 8)}`, notional, updatedAt: now() };

  if (action.kind === "prediction_order") {
    const terms = await priv<{ hasAcceptedLatest: boolean }>("/v1/prediction-markets/terms/status", {}, "GET");
    if (!terms.hasAcceptedLatest) throw new ExchangeError("Accept Gemini's prediction-market terms first (New job → Exchange)", "terms");
    if (action.combo && action.symbol === "COMBO") {
      // The exchange makes the combination a contract of its own (or hands back the one that exists); the order then goes to that.
      const legs = action.combo.legs.map((l) => ({ contractId: l.contractId, requiredOutcome: l.side === "yes" ? "Yes" : "No" }));
      if (legs.some((l) => !l.contractId)) throw new ExchangeError("One leg of the combination has no contract id on this exchange");
      const made = await priv<{ contract?: { instrumentSymbol?: string }; instrumentSymbol?: string; combo?: { contract?: { instrumentSymbol?: string } } }>("/v1/prediction-markets/combos", { legs });
      const symbol = made.contract?.instrumentSymbol ?? made.instrumentSymbol ?? made.combo?.contract?.instrumentSymbol;
      if (!symbol) throw new ExchangeError("The exchange didn't return the combined contract");
      return placeOrder({ ...action, symbol }, since);
    }
    const dup = await alreadyPlaced(action, since).catch(() => undefined);
    if (!dup && action.trade === "sell") {
      // Never sell more than is held and free (not already on hold for another order).
      const held = (await positions()).positions.find((x) => x.symbol === action.symbol && x.outcome === action.side);
      if (!held || held.available < action.quantity)
        throw new ExchangeError(`You hold ${held?.available ?? 0} free ${action.side.toUpperCase()} contracts of ${action.label}; can't sell ${action.quantity}`);
    }
    if (dup)
      return { venue, status: dup.status === "filled" ? "filled" : "open", detail, orderId: String(dup.orderId), notional, symbol: action.symbol, quantity: action.quantity, filledQuantity: Number(dup.filledQuantity ?? 0), updatedAt: now() };
    const r = await priv<{ orderId: number; status: string; filledQuantity?: string; avgExecutionPrice?: string | null }>("/v1/prediction-markets/order", {
      symbol: action.symbol,
      orderType: action.orderType,
      side: action.trade ?? "buy",
      outcome: action.side,
      quantity: String(action.quantity),
      price: action.maxPrice.toFixed(2),
      ...(action.orderType === "stop-limit" ? { stopPrice: (action.stopPrice ?? action.maxPrice).toFixed(2) } : {}),
      timeInForce: "good-til-cancel",
    });
    return {
      venue,
      status: r.status === "filled" ? "filled" : r.status === "cancelled" ? "cancelled" : "open",
      detail,
      orderId: String(r.orderId),
      notional,
      symbol: action.symbol,
      quantity: action.quantity,
      filledQuantity: Number(r.filledQuantity ?? 0),
      avgPrice: r.avgExecutionPrice ? Number(r.avgExecutionPrice) : undefined,
      updatedAt: now(),
    };
  }

  // Round to the symbol's steps so the exchange accepts it, never above the approved amount.
  const rules = await spotRules(action.symbol);
  if (!rules.open) throw new ExchangeError(`${action.symbol.toUpperCase()} isn't open for trading`);
  const price = stepDown(action.limitPrice, rules.quoteStep);
  const amount = stepDown(action.amountUsd / Number(price), rules.tick);
  if (Number(amount) < rules.min) throw new ExchangeError(`$${action.amountUsd} is below the minimum order (${rules.min} ${action.symbol.replace(/usd$/, "").toUpperCase()})`);
  // A client id per job step lets a retry find the first attempt instead of buying twice.
  const clientId = `agento-${Math.floor(since / 1000)}-${action.symbol}`;
  const open = await priv<{ order_id: string; client_order_id?: string; is_live: boolean; executed_amount: string; avg_execution_price: string }[]>("/v1/orders").catch(() => []);
  const prior = Array.isArray(open) ? open.find((o) => o.client_order_id === clientId) : undefined;
  if (prior) return { venue, status: "open", detail, orderId: String(prior.order_id), notional, symbol: action.symbol, quantity: Number(amount), filledQuantity: Number(prior.executed_amount ?? 0), updatedAt: now() };
  const r = await priv<{ order_id: string; is_live: boolean; is_cancelled: boolean; executed_amount: string; avg_execution_price: string }>("/v1/order/new", {
    symbol: action.symbol,
    side: action.side,
    type: "exchange limit",
    price,
    amount,
    client_order_id: clientId,
  });
  const filled = Number(r.executed_amount ?? 0);
  return {
    venue,
    status: r.is_cancelled ? "cancelled" : r.is_live ? "open" : filled > 0 ? "filled" : "open",
    detail,
    orderId: String(r.order_id),
    notional,
    symbol: action.symbol,
    quantity: Number(amount),
    filledQuantity: filled,
    avgPrice: Number(r.avg_execution_price) || undefined,
    updatedAt: now(),
  };
}

export interface Position {
  symbol: string;
  eventTicker: string;
  label: string;
  event: string;
  outcome: "yes" | "no";
  quantity: number;
  /** Not on hold for an open order, so it can be sold now. */
  available: number;
  avgPrice: number;
  /** Best price someone pays for it right now (what a sell gets). */
  sellPrice: number | null;
  marketValue: number;
  unrealizedPnl: number;
  expiry?: string;
}

/** What the user holds on the connected exchange. Simulation holds nothing. */
export async function positions(): Promise<{ venue: Venue; positions: Position[] }> {
  const venue = tradingVenue();
  if (venue === "paper") return { venue, positions: [] };
  type Raw = {
    symbol: string;
    totalQuantity: string;
    quantityOnHold?: string;
    avgPrice: string;
    outcome: "yes" | "no";
    contractMetadata?: { contractName?: string; eventTicker?: string; eventName?: string; expiryDate?: string | null; contractStatus?: string };
    prices?: { sell?: { yes?: string | null; no?: string | null } } | null;
    marketValue?: string;
    unrealizedPnl?: string;
  };
  const r = await priv<{ positions: Raw[] }>("/v1/prediction-markets/positions", {});
  const n = (v: unknown) => (v == null || v === "" ? null : Number(v));
  return {
    venue,
    positions: (r.positions ?? [])
      .filter((p) => Number(p.totalQuantity) > 0)
      .map((p) => ({
        symbol: p.symbol,
        eventTicker: p.contractMetadata?.eventTicker ?? "",
        label: p.contractMetadata?.contractName ?? p.symbol,
        event: p.contractMetadata?.eventName ?? "",
        outcome: p.outcome,
        quantity: Number(p.totalQuantity),
        available: Number(p.totalQuantity) - Number(p.quantityOnHold ?? 0),
        avgPrice: Number(p.avgPrice),
        sellPrice: n(p.prices?.sell?.[p.outcome]),
        marketValue: Number(p.marketValue ?? 0),
        unrealizedPnl: Number(p.unrealizedPnl ?? 0),
        expiry: p.contractMetadata?.expiryDate ?? undefined,
      })),
  };
}

type PmOrder = { orderId: number; status: "open" | "filled" | "cancelled"; filledQuantity: string; quantity: string; avgExecutionPrice: string | null };

/** Latest state of an order placed for a move. */
/** An order's latest state, read from the venue it was placed on. */
export async function refreshOrder(o: OrderResult, kind: MoveAction["kind"]): Promise<OrderResult> {
  if (!o.orderId || o.venue === "paper" || !venueReady(o.venue)) return o;
  return venueStore.run(o.venue, () => refreshOn(o, kind));
}

async function refreshOn(o: OrderResult, kind: MoveAction["kind"]): Promise<OrderResult> {
  const id = Number(o.orderId);
  if (kind === "prediction_order") {
    const active = await priv<{ orders: PmOrder[] }>("/v1/prediction-markets/orders/active", { symbol: o.symbol, limit: 100 });
    let found = active.orders.find((x) => x.orderId === id);
    if (!found) found = (await priv<{ orders: PmOrder[] }>("/v1/prediction-markets/orders/history", { symbol: o.symbol, limit: 100 })).orders.find((x) => x.orderId === id);
    if (!found) return o;
    return { ...o, status: found.status, filledQuantity: Number(found.filledQuantity ?? 0), avgPrice: found.avgExecutionPrice ? Number(found.avgExecutionPrice) : undefined, updatedAt: now() };
  }
  const r = await priv<{ is_live: boolean; is_cancelled: boolean; executed_amount: string; avg_execution_price: string }>("/v1/order/status", { order_id: id });
  const filled = Number(r.executed_amount ?? 0);
  return { ...o, status: r.is_live ? "open" : r.is_cancelled ? "cancelled" : "filled", filledQuantity: filled, avgPrice: Number(r.avg_execution_price) || undefined, updatedAt: now() };
}

export async function cancelOrder(o: OrderResult, kind: MoveAction["kind"]): Promise<OrderResult> {
  if (o.venue === "paper") return { ...o, status: "cancelled", updatedAt: now() };
  if (!o.orderId) throw new ExchangeError("No order to cancel");
  if (!venueReady(o.venue)) throw new ExchangeError(`${VENUE_NAME[o.venue]} isn't connected on this server any more`, "auth");
  return venueStore.run(o.venue, () => cancelOn(o, kind));
}

async function cancelOn(o: OrderResult, kind: MoveAction["kind"]): Promise<OrderResult> {
  if (kind === "prediction_order") await priv("/v1/prediction-markets/order/cancel", { orderId: Number(o.orderId) });
  else await priv("/v1/order/cancel", { order_id: Number(o.orderId) });
  return refreshOrder({ ...o, status: "cancelled" }, kind).catch(() => ({ ...o, status: "cancelled" as const, updatedAt: now() }));
}

/** The current terms text, public, shown to the user before they accept. */
export async function getTerms(): Promise<{ version: number; content: string; updatedAt: string }> {
  const r = await fetch(`${tradeBase()}/v1/prediction-markets/terms`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new ExchangeError(`terms ${r.status}`, "unavailable");
  return r.json();
}
