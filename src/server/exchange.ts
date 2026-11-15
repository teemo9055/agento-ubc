import { createHmac, randomUUID } from "node:crypto";
import type { MoveAction, OrderResult, Venue } from "@/lib/types";
import { PROD_BASE, SANDBOX_BASE } from "./gemini";

/**
 * Gemini exchange client for the moves users approve.
 * - gemini-sandbox (default when keys are set): Gemini's test exchange, real order flow, test funds.
 * - gemini: real money, only with GEMINI_TRADING_ENV=production.
 * - paper: no keys; nothing is sent and every result says "simulation".
 * Keys sign each request locally (HMAC-SHA384), so they stay in the server env.
 * Endpoints follow developer.gemini.com (Prediction Markets REST + spot order API).
 */
const PROD = process.env.GEMINI_TRADING_ENV === "production";
const KEY = process.env.GEMINI_TRADING_KEY;
const SECRET = process.env.GEMINI_TRADING_SECRET;

export const tradingVenue = (): Venue => (KEY && SECRET ? (PROD ? "gemini" : "gemini-sandbox") : "paper");
export const VENUE_NAME: Record<Venue, string> = { "gemini-sandbox": "Gemini sandbox", gemini: "Gemini", paper: "Simulation" };
export const VENUE_NOTE: Record<Venue, string> = {
  "gemini-sandbox": "Gemini's test exchange: real orders, test money",
  gemini: "Real money on Gemini",
  paper: "Simulation: no exchange is connected, nothing is sent",
};
/** Where tradable markets and their order books live for a venue. */
export const marketBase = (v: Venue = tradingVenue()) => (v === "gemini-sandbox" ? SANDBOX_BASE : PROD_BASE);
const tradeBase = () => (PROD ? PROD_BASE : SANDBOX_BASE);

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
  if (!KEY || !SECRET) throw new ExchangeError("No exchange connected", "auth");
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

/** Only on the user's explicit click: accepting terms is their decision. */
export async function acceptTerms() {
  return priv<{ success: boolean }>("/v1/prediction-markets/terms/accept");
}

// ---------- orders ----------

/** Most the order can cost, in USD. */
/** What the move can spend. Selling spends nothing: it returns money. */
export const notionalOf = (a: MoveAction) => (a.kind === "prediction_order" ? (a.trade === "sell" ? 0 : a.maxPrice * a.quantity) : a.kind === "spot_order" ? a.amountUsd : 0);

const cents = (x: number) => `${Math.round(x * 100)}¢`;
export function describeAction(a: MoveAction) {
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
  if (venue === "paper") return { venue, status: "simulated", detail: `Simulation only: ${detail}`, orderId: `sim-${randomUUID().slice(0, 8)}`, notional, updatedAt: now() };

  if (action.kind === "prediction_order") {
    const terms = await priv<{ hasAcceptedLatest: boolean }>("/v1/prediction-markets/terms/status", {}, "GET");
    if (!terms.hasAcceptedLatest) throw new ExchangeError("Accept Gemini's prediction-market terms first (New job → Exchange)", "terms");
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
export async function refreshOrder(o: OrderResult, kind: MoveAction["kind"]): Promise<OrderResult> {
  if (!o.orderId || o.venue === "paper" || o.venue !== tradingVenue()) return o;
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
