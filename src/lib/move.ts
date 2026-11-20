import type { MoveAction, MoveCondition, Proposal } from "./types";

/** How a move reads in words and what it can cost. Shared by the chat, the workspace and the plan board. */
/** What each paid lookup costs, in USD, as shown before you approve. A test keeps it equal to what the server pays. */
export const RESEARCH_PRICE: Record<string, number> = {
  odds_history: 0.02,
  trade_tape: 0.1,
  spot_candles: 0.02,
  drive_route: 0.03,
  oracle_price: 0.0001,
  gas_price: 0.0001,
  btc_network: 0.0002,
  wallet_balance: 0.0001,
  web_search: 0.002,
  news_search: 0.002,
  place_reviews: 0.004,
  shopping_prices: 0.004,
  image_check: 0.006,
  phone_check: 0.01,
  company_record: 0.01,
  read_page: 0.001,
  read_listing: 0.001,
  market_odds: 0.002,
  headcount_history: 0.084,
  funding_events: 0.04,
  company_events: 0.04,
  deep_search: 0.007,
  read_article: 0.001,
};
/** What a paid lookup costs; a marketplace service carries the price its seller quoted. */
export const lookupCost = (r: Proposal["research"][number]) => (r.tool === "service" ? Number(r.args.price ?? 0) / 1e6 : (RESEARCH_PRICE[r.tool] ?? 0));
export const usdc = (x: number) => (x < 0.01 ? x.toFixed(4) : x.toFixed(2));
export const cents = (x: number) => `${Math.round(x * 100)}¢`;

/** A leg of a combination in plain words: NO on "$65,000 or above" reads "Below $65,000". */
export function legText(l: { label: string; side: "yes" | "no" }) {
  if (l.side === "yes") return l.label;
  const up = l.label.match(/^(.+?) or (above|higher|more)$/i);
  if (up) return `Below ${up[1]}`;
  const down = l.label.match(/^(.+?) or (below|lower|less)$/i);
  if (down) return `Above ${down[1]}`;
  return `Not: ${l.label}`;
}

export function actionText(a: MoveAction) {
  if (a.kind === "prediction_order" && a.combo) return `${a.quantity} × one contract that pays only if all ${a.combo.legs.length} happen, at ≤ ${cents(a.maxPrice)}, resting until filled`;
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
  const what = c.metric === "oracle_price" ? `Chainlink ${coin}` : c.metric === "spot_price" ? `${coin} price` : c.metric === "yes_price" ? "Its price" : "The other side's price";
  const dollars = c.metric === "spot_price" || c.metric === "oracle_price";
  // Spelled out: "is $64,000 or more", not a symbol.
  return `${what} is ${dollars ? `$${c.value.toLocaleString()}` : cents(c.value)} or ${c.op === "<=" ? "less" : "more"}`;
}

/** The most an order can spend. Selling spends nothing. */
export const maxCost = (a?: MoveAction) => (!a ? 0 : a.kind === "prediction_order" ? (a.trade === "sell" ? 0 : a.maxPrice * a.quantity) : a.kind === "spot_order" ? a.amountUsd : 0);
