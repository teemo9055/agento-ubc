import * as gemini from "./gemini";
import { snapshot } from "./live";
import type { MoveAction, OrderResult } from "@/lib/types";

/**
 * Following an order on the live market. A test-exchange order rests where few people trade, so
 * beside it the app watches the same contract on Gemini's live market: once a live seller offers
 * it at the order's price or better, it records that the order would have filled there, at that
 * price and time. It never fills twice and never above the order's price. Nothing is bought.
 */

type Order = Extract<MoveAction, { kind: "prediction_order" }>;

/** Orders this applies to: buys on the test exchange (or practice), not real-exchange orders. */
export function followsLive(o: OrderResult | undefined, a: MoveAction | undefined): a is Order {
  return Boolean(o && a?.kind === "prediction_order" && a.trade !== "sell" && !a.combo && (o.venue === "gemini-sandbox" || o.venue === "paper") && !["rejected", "skipped"].includes(o.status));
}

/** Pure: the next live-market state for an order, given the live ask for the side it buys. */
export function nextShadow(o: OrderResult, a: Order, liveAsk: number | null, at = new Date().toISOString()): OrderResult["shadow"] {
  if (o.shadow?.state === "filled") return o.shadow;
  if (liveAsk != null && liveAsk > 0 && liveAsk <= a.maxPrice) return { state: "filled", price: liveAsk, at, liveAsk };
  return { state: "waiting", liveAsk: liveAsk ?? undefined, at };
}

/** Reads the live market for the order's contract and returns the order with its live-market state. */
export async function checkShadow(o: OrderResult, a: MoveAction): Promise<OrderResult> {
  if (!followsLive(o, a) || o.shadow?.state === "filled") return o;
  const [t] = await snapshot([{ eventTicker: a.eventTicker, symbol: a.symbol }], gemini.PROD_BASE).catch(() => []);
  if (!t) return o;
  // Buying NO costs 1 minus the best YES bid.
  const ask = a.side === "yes" ? t.ask : t.bid != null ? Math.round((1 - t.bid) * 100) / 100 : null;
  const shadow = nextShadow(o, a, ask);
  return JSON.stringify(shadow) === JSON.stringify(o.shadow) ? o : { ...o, shadow };
}
