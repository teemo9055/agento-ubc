import type { MoveAction, Proposal } from "./types";

/**
 * Words for people. One place turns a move into everyday sentences: what you pay, what you get
 * and when, with no market shorthand. The exact contract, side and price stay in the details.
 */
const money = (x: number) => `$${x < 0.01 && x > 0 ? x.toFixed(4) : Number.isInteger(x) ? x : x.toFixed(2)}`;
const coin = (s: string) => s.replace(/usd$/, "").toUpperCase();

/** A price between 0 and 1 as a chance someone can picture. */
export function chance(p: number): string {
  if (p >= 0.93) return "very likely";
  if (p <= 0.07) return "very unlikely";
  const table: [number, string][] = [[0.1, "1 in 10"], [0.125, "1 in 8"], [0.167, "1 in 6"], [0.2, "1 in 5"], [0.25, "1 in 4"], [0.333, "1 in 3"], [0.4, "2 in 5"], [0.5, "1 in 2"], [0.6, "3 in 5"], [0.667, "2 in 3"], [0.75, "3 in 4"], [0.8, "4 in 5"], [0.9, "9 in 10"]];
  const best = table.reduce((a, b) => (Math.abs(b[0] - p) < Math.abs(a[0] - p) ? b : a));
  return `about ${best[1]}`;
}

type Prediction = Extract<MoveAction, { kind: "prediction_order" }>;

/** What has to be true for a prediction order to pay, as a clause: "BTC is $65,000 or above (BTC price on November 30)". */
export function paysIf(a: Prediction): string {
  if (a.combo) return `all ${a.combo.legs.length} of these happen`;
  const where = a.event ? ` (${a.event})` : "";
  return a.side === "yes" ? `“${a.label}” happens${where}` : `“${a.label}” doesn't happen${where}`;
}

/** A short name for the move, from what it does. */
export function titleOf(p: Pick<Proposal, "action" | "hedge" | "title">): string {
  const a = p.action;
  if (!a) return p.title;
  if (a.kind === "itinerary") return `Drive: ${a.stops.join(" → ")}`.slice(0, 60);
  if (a.kind === "spot_order") return `${a.side === "buy" ? "Buy" : "Sell"} ${coin(a.symbol)}`;
  if (p.hedge && a.trade !== "sell") return `Cover: ${p.hedge.protects}`.slice(0, 60);
  if (a.combo) return `Pays if all ${a.combo.legs.length} happen`;
  return `${a.trade === "sell" ? "Sell" : a.side === "yes" ? "Yes" : "No"}: ${a.label}`.slice(0, 60);
}

/** The yes-or-no question put to the user, with what it costs and what it gives. */
export function askOf(p: Pick<Proposal, "action" | "hedge" | "ask">): string {
  const a = p.action;
  if (!a) return p.ask;
  if (a.kind === "itinerary") return `Plan ${a.stops.join(" → ")} with at most ${a.hoursPerDay} hours of driving a day?`;
  if (a.kind === "spot_order") return a.side === "buy" ? `Buy ${money(a.amountUsd)} of ${coin(a.symbol)} if the price is $${a.limitPrice.toLocaleString()} or lower?` : `Sell ${money(a.amountUsd)} of ${coin(a.symbol)} if the price is $${a.limitPrice.toLocaleString()} or higher?`;
  if (a.trade === "sell") return `Sell ${a.quantity} for at least ${money(a.maxPrice * a.quantity)}?`;
  return `Pay up to ${money(Math.round(a.maxPrice * a.quantity * 100) / 100)} to get ${money(a.quantity)} if ${paysIf(a)}?`;
}
