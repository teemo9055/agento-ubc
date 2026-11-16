import type { MoveAction, MoveCondition, Proposal } from "./types";

/** How a move reads in words and what it can cost. Shared by the chat, the workspace and the plan board. */
const RESEARCH_PRICE: Record<string, number> = { odds_history: 0.02, trade_tape: 0.1, spot_candles: 0.02, drive_route: 0.03, oracle_price: 0.0001, gas_price: 0.0001, btc_network: 0.0002, wallet_balance: 0.0001 };
/** What a paid lookup costs; a marketplace service carries the price its seller quoted. */
export const lookupCost = (r: Proposal["research"][number]) => (r.tool === "service" ? Number(r.args.price ?? 0) / 1e6 : (RESEARCH_PRICE[r.tool] ?? 0));
export const usdc = (x: number) => (x < 0.01 ? x.toFixed(4) : x.toFixed(2));
export const cents = (x: number) => `${Math.round(x * 100)}¢`;

export function actionText(a: MoveAction) {
  if (a.kind === "prediction_order" && a.trade === "sell") return `Sell ${a.quantity} × ${a.side.toUpperCase()} “${a.label}” at ≥ ${cents(a.maxPrice)}, resting until filled`;
  if (a.kind === "prediction_order")
    return a.orderType === "stop-limit"
      ? `${a.quantity} × ${a.side.toUpperCase()} “${a.label}” once it rises to ${cents(a.stopPrice ?? a.maxPrice)}, paying ≤ ${cents(a.maxPrice)}`
      : `${a.quantity} × ${a.side.toUpperCase()} “${a.label}” at ≤ ${cents(a.maxPrice)}, resting until filled`;
  if (a.kind === "spot_order") return `${a.side === "buy" ? "Buy" : "Sell"} $${a.amountUsd} of ${a.symbol.replace(/usd$/, "").toUpperCase()} at ${a.side === "buy" ? "≤" : "≥"} $${a.limitPrice.toLocaleString()}`;
  return `Plan ${a.stops.join(" → ")} · ≤ ${a.hoursPerDay} h/day`;
}

export function conditionLabel(c: MoveCondition) {
  const coin = c.symbol.replace(/usd$/, "").toUpperCase();
  const what = c.metric === "oracle_price" ? `Chainlink ${coin}` : c.metric === "spot_price" ? `${coin} price` : c.metric === "yes_price" ? "YES price" : "NO price";
  const dollars = c.metric === "spot_price" || c.metric === "oracle_price";
  return `${what} ${c.op === "<=" ? "≤" : "≥"} ${dollars ? `$${c.value.toLocaleString()}` : cents(c.value)}`;
}

/** The most an order can spend. Selling spends nothing. */
export const maxCost = (a?: MoveAction) => (!a ? 0 : a.kind === "prediction_order" ? (a.trade === "sell" ? 0 : a.maxPrice * a.quantity) : a.kind === "spot_order" ? a.amountUsd : 0);
