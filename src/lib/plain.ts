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

/** The outcome a prediction order is on, the way a person would say it: NO on "$65,000 or above" is "Below $65,000". */
export function outcomeOf(a: Pick<Prediction, "label" | "side">): string {
  if (a.side === "yes") return a.label;
  const up = a.label.match(/^(.+?) or (above|higher|more)$/i);
  if (up) return `Below ${up[1]}`;
  const down = a.label.match(/^(.+?) or (below|lower|less)$/i);
  if (down) return `Above ${down[1]}`;
  return `Not “${a.label}”`;
}

/** A short name for the move, from what it does. */
export function titleOf(p: Pick<Proposal, "action" | "hedge" | "title">): string {
  const a = p.action;
  if (!a) return p.title;
  if (a.kind === "itinerary") return `Drive: ${a.stops.join(" → ")}`.slice(0, 60);
  if (a.kind === "spot_order") return `${a.side === "buy" ? "Buy" : "Sell"} ${coin(a.symbol)}`;
  if (p.hedge && a.trade !== "sell") return `Cover: ${p.hedge.protects}`.slice(0, 60);
  if (a.combo) return `Pays if all ${a.combo.legs.length} happen`;
  const what = a.event ? `${a.event}: ${outcomeOf(a)}` : outcomeOf(a);
  return `${a.trade === "sell" ? "Sell: " : ""}${what}`.slice(0, 60);
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

/** What the order step does, in one plain line. */
export function doesLine(a: MoveAction): { label: string; detail: string } {
  if (a.kind === "itinerary") return { label: "Split into days", detail: `${a.stops.join(" → ")} · at most ${a.hoursPerDay} h of driving a day` };
  if (a.kind === "spot_order") return a.side === "buy" ? { label: `Buy ${money(a.amountUsd)} of ${coin(a.symbol)}`, detail: `only at $${a.limitPrice.toLocaleString()} or lower` } : { label: `Sell ${money(a.amountUsd)} of ${coin(a.symbol)}`, detail: `only at $${a.limitPrice.toLocaleString()} or higher` };
  const total = Math.round(a.maxPrice * a.quantity * 100) / 100;
  if (a.trade === "sell") return { label: `Sell ${a.quantity}`, detail: `for ${Math.round(a.maxPrice * 100)}¢ each or more` };
  const wait = a.orderType === "stop-limit" ? `, once the price reaches ${Math.round((a.stopPrice ?? a.maxPrice) * 100)}¢` : "";
  return { label: `Pay up to ${money(total)}`, detail: `${Math.round(a.maxPrice * 100)}¢ or less for each $1 it can pay${wait}` };
}

/** What you end up with, in one plain line. */
export function getsLine(p: Pick<Proposal, "action" | "hedge">): { label: string; detail: string } {
  const a = p.action;
  if (!a) return { label: "The answer", detail: "with the numbers and who was paid" };
  if (a.kind === "itinerary") return { label: "A day-by-day plan", detail: "with places to stay each night" };
  if (a.kind === "spot_order") return a.side === "buy" ? { label: `${coin(a.symbol)} in your account`, detail: "at your price or better" } : { label: `About ${money(a.amountUsd)} in cash`, detail: "when the sale goes through" };
  if (a.trade === "sell") return { label: `About ${money(a.maxPrice * a.quantity)} back`, detail: "when the sale goes through" };
  const odds = `the market puts that at ${chance(a.maxPrice)}`;
  if (a.combo) return { label: `${money(a.quantity)} if all ${a.combo.legs.length} happen`, detail: "nothing if any one doesn't" };
  if (p.hedge) return { label: `${money(p.hedge.payout)} if it happens`, detail: `covers ${Math.round((p.hedge.covered / p.hedge.lossUsd) * 100)}% of a ${money(p.hedge.lossUsd)} loss on ${p.hedge.protects}` };
  return { label: `${money(a.quantity)} if it's ${a.side === "yes" ? "" : "not "}“${a.label}”`, detail: `${odds}; nothing if it goes the other way` };
}

/** Everyday names for paid lookups, used for steps whatever label the agent wrote. */
const STEP_NAME: Record<string, (args: Record<string, string>) => string> = {
  odds_history: () => "How the odds moved",
  trade_tape: () => "Recent trades",
  spot_candles: (a) => `${(a.symbol ?? "").replace(/usd$/i, "").toUpperCase()} price chart`.trim(),
  oracle_price: (a) => `Chainlink ${(a.symbol ?? "").replace(/usd$/i, "").toUpperCase()} price`.trim(),
  gas_price: (a) => `Network fee on ${a.chain ? a.chain[0].toUpperCase() + a.chain.slice(1) : "the chain"}`,
  btc_network: () => "Bitcoin network fees",
  wallet_balance: () => "Wallet balance",
  drive_route: () => "Driving route",
};
export const stepName = (r: { tool: string; args: Record<string, string>; label: string }) => STEP_NAME[r.tool]?.(r.args) ?? r.label;

/** Market shorthand the agent's own sentences shouldn't use, and what to say instead. */
const SWAPS: [RegExp, string][] = [
  [/\bcombos?\b/gi, "combined cover"],
  [/\b(both|all|the|two|three) legs\b/gi, "$1 parts"],
  [/\blegs\b/gi, "parts"],
  [/\bhedging\b/gi, "covering"],
  [/\bhedged\b/gi, "covered"],
  [/\bhedges\b/gi, "covers"],
  [/\b(a|the|your|this|fuel|price) hedge\b/gi, "$1 cover"],
  [/\bhedge\b/gi, "cover"],
  [/\bdownside\b/gi, "drop"],
  [/\bupside\b/gi, "gain"],
  [/\bbinary (floor|contract|option)s?\b/gi, "cover"],
  [/\bresting (limit )?orders?\b/gi, "waiting order"],
  [/\ba limit order\b/gi, "an order at your price"],
  [/\blimit orders?\b/gi, "order at your price"],
  [/\bliquidity\b/gi, "buyers and sellers"],
  [/\bslippage\b/gi, "price drift"],
  [/\bvolatility\b/gi, "price swings"],
  [/\bvolatile\b/gi, "jumpy"],
  [/\bpremium\b/gi, "cost"],
  [/\bnotional\b/gi, "amount"],
  [/\bstrike\b/gi, "line"],
];
export const SHORTHAND = /\b(combos?|legs|hedg(e|es|ed|ing)|downside|upside|binary|resting|limit orders?|liquidity|slippage|volatil(e|ity)|premium|notional|strike)\b/i;

/** Rewrites market shorthand in a sentence into everyday words. */
export function plainWords(text: string): string {
  let out = text;
  for (const [re, to] of SWAPS) out = out.replace(re, (m, g1) => {
    const word = to.replace("$1", g1 ?? "");
    return /^[A-Z]/.test(m) ? word[0].toUpperCase() + word.slice(1) : word;
  });
  return out;
}
