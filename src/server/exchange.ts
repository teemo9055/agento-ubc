import { createHmac, randomUUID } from "node:crypto";
import type { MoveAction, OrderResult } from "@/lib/types";

/**
 * Places an approved order on Gemini. Sandbox by default (test balances, real
 * order flow). Without keys the order is recorded as a paper trade and never sent.
 * Keys sign each request locally (HMAC), so they live in the server env.
 */
const SANDBOX = process.env.GEMINI_TRADING_ENV !== "production";
const BASE = SANDBOX ? "https://api.sandbox.gemini.com" : "https://api.gemini.com";
const KEY = process.env.GEMINI_TRADING_KEY;
const SECRET = process.env.GEMINI_TRADING_SECRET;

export const tradingVenue = (): OrderResult["venue"] => (KEY && SECRET ? (SANDBOX ? "gemini-sandbox" : "gemini") : "paper");
export const VENUE_NAME: Record<OrderResult["venue"], string> = { "gemini-sandbox": "Gemini sandbox", gemini: "Gemini", paper: "Paper trade" };

async function signed(path: string, body: Record<string, unknown>) {
  const payload = Buffer.from(JSON.stringify({ request: path, nonce: Date.now().toString(), ...body })).toString("base64");
  const signature = createHmac("sha384", SECRET!).update(payload).digest("hex");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "text/plain", "x-gemini-apikey": KEY!, "x-gemini-payload": payload, "x-gemini-signature": signature, "cache-control": "no-cache" },
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.result === "error") throw new Error(String(json.message ?? json.reason ?? `HTTP ${res.status}`));
  return json;
}

/** Most the order can cost, in USD. */
export const notionalOf = (a: MoveAction) => (a.kind === "prediction_order" ? a.maxPrice * a.quantity : a.kind === "spot_order" ? a.amountUsd : 0);

export function describeAction(a: MoveAction) {
  if (a.kind === "prediction_order") return `${a.quantity} × ${a.side.toUpperCase()} “${a.label}” at ≤ ${Math.round(a.maxPrice * 100)}¢`;
  if (a.kind === "spot_order") return `${a.side === "buy" ? "Buy" : "Sell"} $${a.amountUsd} of ${a.symbol.replace(/usd$/, "").toUpperCase()} at ${a.side === "buy" ? "≤" : "≥"} $${a.limitPrice}`;
  return `Itinerary: ${a.stops.join(" → ")}`;
}

export async function placeOrder(action: MoveAction): Promise<OrderResult> {
  const venue = tradingVenue();
  const notional = notionalOf(action);
  const detail = describeAction(action);
  if (action.kind === "itinerary") return { venue: "paper", status: "placed", detail, notional: 0 };
  if (venue === "paper") return { venue, status: "placed", detail, orderId: `paper-${randomUUID().slice(0, 8)}`, notional };
  try {
    const r =
      action.kind === "prediction_order"
        ? await signed("/v1/prediction-markets/order", {
            symbol: action.symbol,
            orderType: "limit",
            side: "buy",
            outcome: action.side,
            quantity: String(action.quantity),
            price: action.maxPrice.toFixed(2),
            timeInForce: "good-til-cancel",
          })
        : await signed("/v1/order/new", {
            symbol: action.symbol,
            side: action.side,
            type: "exchange limit",
            price: String(action.limitPrice),
            amount: (action.amountUsd / action.limitPrice).toPrecision(6),
            client_order_id: `agento-${randomUUID().slice(0, 8)}`,
          });
    const filled = Number(r.executed_amount ?? r.filledQuantity ?? 0) > 0;
    return { venue, status: filled ? "filled" : "placed", detail, orderId: String(r.order_id ?? r.orderId ?? r.id ?? ""), notional };
  } catch (e) {
    return { venue, status: "rejected", detail: `${detail} · ${(e as Error).message.slice(0, 120)}`, notional };
  }
}
