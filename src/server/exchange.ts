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
  const payload = Buffer.from(JSON.stringify({ request: path, nonce: String(lastNonce), ...body })).toString("base64");
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
export const notionalOf = (a: MoveAction) => (a.kind === "prediction_order" ? a.maxPrice * a.quantity : a.kind === "spot_order" ? a.amountUsd : 0);

const cents = (x: number) => `${Math.round(x * 100)}¢`;
export function describeAction(a: MoveAction) {
  if (a.kind === "prediction_order")
    return a.orderType === "stop-limit"
      ? `${a.quantity} × ${a.side.toUpperCase()} “${a.label}” once it rises to ${cents(a.stopPrice ?? a.maxPrice)}, paying ≤ ${cents(a.maxPrice)}`
      : `${a.quantity} × ${a.side.toUpperCase()} “${a.label}” at ≤ ${cents(a.maxPrice)}`;
  if (a.kind === "spot_order") return `${a.side === "buy" ? "Buy" : "Sell"} $${a.amountUsd} of ${a.symbol.replace(/usd$/, "").toUpperCase()} at ${a.side === "buy" ? "≤" : "≥"} $${a.limitPrice}`;
  return `Itinerary: ${a.stops.join(" → ")}`;
}

const now = () => new Date().toISOString();

export async function placeOrder(action: MoveAction): Promise<OrderResult> {
  const venue = tradingVenue();
  const notional = notionalOf(action);
  const detail = describeAction(action);
  if (action.kind === "itinerary") return { venue: "paper", status: "simulated", detail, notional: 0 };
  if (venue === "paper") return { venue, status: "simulated", detail: `Simulation only: ${detail}`, orderId: `sim-${randomUUID().slice(0, 8)}`, notional, updatedAt: now() };

  if (action.kind === "prediction_order") {
    const terms = await priv<{ hasAcceptedLatest: boolean }>("/v1/prediction-markets/terms/status", {}, "GET");
    if (!terms.hasAcceptedLatest) throw new ExchangeError("Accept Gemini's prediction-market terms first (New job → Exchange)", "terms");
    const r = await priv<{ orderId: number; status: string; filledQuantity?: string; avgExecutionPrice?: string | null }>("/v1/prediction-markets/order", {
      symbol: action.symbol,
      orderType: action.orderType,
      side: "buy",
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

  const amount = (action.amountUsd / action.limitPrice).toPrecision(6);
  const r = await priv<{ order_id: string; is_live: boolean; is_cancelled: boolean; executed_amount: string; avg_execution_price: string }>("/v1/order/new", {
    symbol: action.symbol,
    side: action.side,
    type: "exchange limit",
    price: String(action.limitPrice),
    amount,
    client_order_id: `agento-${randomUUID().slice(0, 8)}`,
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
