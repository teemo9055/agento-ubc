import type { Proposal } from "./types";
import { lookupCost } from "./move";

/**
 * The changes people make most often to a move, done by code so the drawing updates at once
 * instead of waiting for the agent: a bit more, a bit less, a better or worse price, fewer
 * paid lookups, longer or shorter driving days. Anything else is said to the agent in words.
 */
export type AdjustKind = "more" | "less" | "pay-more" | "pay-less" | "drop-lookups" | "drop-check";

export interface Adjustment {
  kind: AdjustKind;
  /** What the button says, with the real numbers it leads to. */
  label: string;
}

/** The fields of a move an adjustment may touch (the shape the validator takes). */
export interface Adjustable {
  research: unknown[];
  action: null | Record<string, unknown>;
  condition: unknown;
  alsoRequire?: unknown;
  budgetUsd?: number | null;
  hedge?: { protects: string; lossUsd: number } | null;
}

const cents = (x: number) => `${Math.round(x * 100)}¢`;
const dollars = (x: number) => `$${Number.isInteger(x) ? x : x.toFixed(2)}`;
const round2 = (x: number) => Math.round(x * 100) / 100;
/** A step that feels like "a bit": 1 up to 5, 5 up to 30, 10 beyond. */
const stepOf = (n: number) => (n <= 5 ? 1 : n <= 30 ? 5 : 10);

/** How much of something the move is for, and the next sizes up and down. */
export function sizeOf(p: Proposal): { now: number; up: number; down: number | null; unit: "contracts" | "cover" | "dollars" | "hours" } | undefined {
  const a = p.action;
  if (!a) return undefined;
  if (a.kind === "itinerary") return { now: a.hoursPerDay, up: Math.min(12, a.hoursPerDay + 2), down: a.hoursPerDay > 2 ? Math.max(2, a.hoursPerDay - 2) : null, unit: "hours" };
  if (a.kind === "spot_order") return { now: a.amountUsd, up: Math.min(100, a.amountUsd + stepOf(a.amountUsd)), down: a.amountUsd > 1 ? Math.max(1, a.amountUsd - stepOf(a.amountUsd - 1)) : null, unit: "dollars" };
  // Cover is sized by what it protects, so "more" means more protection, and code works out the contracts.
  if (p.hedge && a.trade !== "sell") {
    const l = p.hedge.lossUsd;
    const s = l <= 10 ? 5 : l <= 50 ? 10 : 25;
    return { now: l, up: Math.min(1000, l + s), down: l > 5 ? Math.max(5, l - s) : null, unit: "cover" };
  }
  return { now: a.quantity, up: Math.min(500, a.quantity + stepOf(a.quantity)), down: a.quantity > 1 ? Math.max(1, a.quantity - stepOf(a.quantity - 1)) : null, unit: "contracts" };
}

/** The adjustments that make sense for this move right now, likeliest first. */
export function adjustmentsFor(p: Proposal): Adjustment[] {
  const a = p.action;
  const out: Adjustment[] = [];
  const s = sizeOf(p);
  if (a && s) {
    const price = a.kind === "prediction_order" ? a.maxPrice : 0;
    const sell = (a.kind === "prediction_order" && a.trade === "sell") || (a.kind === "spot_order" && a.side === "sell");
    if (s.up > s.now)
      out.push({
        kind: "more",
        label:
          s.unit === "hours" ? `Longer days (${s.up} h)` : s.unit === "dollars" ? `${sell ? "Sell" : "Buy"} ${dollars(s.up)} instead` : s.unit === "cover" ? `Cover ${dollars(s.up)} instead` : sell ? `Sell ${s.up} instead` : `Buy ${s.up - s.now} more (total ${dollars(round2(s.up * price))})`,
      });
    if (s.down != null)
      out.push({
        kind: "less",
        label:
          s.unit === "hours" ? `Shorter days (${s.down} h)` : s.unit === "dollars" ? `Spend less: only ${dollars(s.down)}` : s.unit === "cover" ? `Cover only ${dollars(s.down)}` : sell ? `Sell only ${s.down}` : `Spend less: ${s.now - s.down} fewer (${dollars(round2(s.down * price))})`,
      });
  }
  if (a?.kind === "prediction_order" && !a.combo) {
    const ask = p.market?.ask;
    const bid = p.market?.bid;
    if (a.trade === "sell") {
      // Selling: asking less sells sooner, asking more holds out.
      if (bid != null && a.maxPrice > bid && bid >= 0.01) out.push({ kind: "pay-less", label: `Sell now at ${cents(bid)}` });
      else if (a.maxPrice < 0.98) out.push({ kind: "pay-more", label: `Hold out for ${cents(a.maxPrice + 0.02)}` });
    } else if (ask != null && a.maxPrice < ask && ask <= 0.99) out.push({ kind: "pay-more", label: `Buy now at ${cents(ask)}` });
    else if (a.maxPrice > 0.03) out.push({ kind: "pay-less", label: `Wait for a lower price (${cents(a.maxPrice - 0.02)})` });
  }
  if (a?.kind === "prediction_order" && a.combo && a.maxPrice > 0.03) out.push({ kind: "pay-less", label: `Pay at most ${cents(a.maxPrice - 0.02)}` });
  if (a && p.research.length) out.push({ kind: "drop-lookups", label: `${p.research.length === 1 ? "Skip the paid lookup" : `Skip the ${p.research.length} paid lookups`} (save $${p.research.reduce((x, r) => x + lookupCost(r), 0) < 0.01 ? p.research.reduce((x, r) => x + lookupCost(r), 0).toFixed(4) : p.research.reduce((x, r) => x + lookupCost(r), 0).toFixed(2)})` });
  if (p.condition) out.push({ kind: "drop-check", label: "Go ahead without the check" });
  return out;
}

/**
 * Applies one adjustment to a move, as the input the validator takes. The validator still has
 * the last word: limits, budget, rounding and the live market apply as for any other move.
 */
export function applyAdjust<T extends Adjustable>(input: T, p: Proposal, kind: AdjustKind): T {
  const out = structuredClone(input);
  const a = out.action as Record<string, number | string | null | undefined> | null;
  const s = sizeOf(p);
  if ((kind === "more" || kind === "less") && a && s) {
    const next = kind === "more" ? s.up : s.down;
    if (next == null || next === s.now) throw new Error(kind === "more" ? "That's as much as one order can be" : "It can't go any smaller");
    if (s.unit === "hours") a.hoursPerDay = next;
    else if (s.unit === "dollars") a.amountUsd = next;
    else if (s.unit === "cover" && out.hedge) out.hedge = { ...out.hedge, lossUsd: next };
    else a.quantity = next;
    // Asking for more is a new instruction: an earlier "at most $X" no longer caps it.
    if (kind === "more") out.budgetUsd = null;
  }
  if ((kind === "pay-more" || kind === "pay-less") && a && p.action?.kind === "prediction_order") {
    const act = p.action;
    const ask = p.market?.ask;
    const bid = p.market?.bid;
    let price = act.maxPrice + (kind === "pay-more" ? 0.02 : -0.02);
    if (!act.combo && act.trade !== "sell" && kind === "pay-more" && ask != null && act.maxPrice < ask) price = ask;
    if (!act.combo && act.trade === "sell" && kind === "pay-less" && bid != null && act.maxPrice > bid) price = bid;
    a.maxPrice = Math.min(0.99, Math.max(0.01, round2(price)));
    if (a.orderType === "stop-limit" && typeof a.stopPrice === "number" && a.stopPrice > (a.maxPrice as number)) a.stopPrice = a.maxPrice;
  }
  if (kind === "drop-lookups") {
    out.research = [];
    // A check on a Chainlink price needs the lookup that reads it.
    const usesOracle = (c: unknown) => (c as { metric?: string } | null)?.metric === "oracle_price";
    if (usesOracle(out.condition)) out.condition = null;
    if (Array.isArray(out.alsoRequire)) out.alsoRequire = out.alsoRequire.filter((c) => !usesOracle(c));
  }
  if (kind === "drop-check") {
    out.condition = null;
    out.alsoRequire = null;
  }
  return out;
}
