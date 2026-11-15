import { describe, expect, it } from "vitest";
import type { Proposal } from "@/lib/types";
import { diffMoves, guardEdit } from "./move-diff";

const base: Proposal = {
  id: "p",
  title: "t",
  why: "w",
  ask: "a",
  venue: "paper",
  research: [{ id: "r1", tool: "odds_history", args: { symbol: "GEMI-X", tf: "15m" }, label: "Odds history", why: "trend" }],
  action: { kind: "prediction_order", eventTicker: "E", symbol: "GEMI-X", label: "X", side: "yes", orderType: "limit", maxPrice: 0.4, quantity: 5 },
};
const clone = (p: Proposal): Proposal => JSON.parse(JSON.stringify(p));

describe("what changed, in plain words", () => {
  it("lists added lookups, new checks and order changes", () => {
    const next = clone(base);
    next.research.push({ id: "r2", tool: "trade_tape", args: { symbol: "GEMI-X" }, label: "Trade flow", why: "who buys" });
    next.condition = { metric: "spot_price", symbol: "btcusd", op: ">=", value: 64000 };
    if (next.action?.kind === "prediction_order") next.action.quantity = 10;
    expect(diffMoves(base, next)).toEqual(["+ Trade flow", "+ check: BTC price ≥ $64,000", "5 → 10 contracts"]);
  });

  it("says nothing when nothing changed", () => {
    expect(diffMoves(base, clone(base))).toEqual([]);
  });
});

describe("edits stay in scope", () => {
  it("editing the order can't swap the market or the lookups", () => {
    const next = clone(base);
    if (next.action?.kind === "prediction_order") Object.assign(next.action, { quantity: 10, symbol: "GEMI-OTHER", label: "Other" });
    next.research = [];
    const { move, undone } = guardEdit(base, next, "act");
    expect(move.action).toMatchObject({ quantity: 10, symbol: "GEMI-X" });
    expect(move.research).toHaveLength(1);
    expect(undone).toEqual(expect.arrayContaining(["the lookups", "the market"]));
  });

  it("editing the check leaves the order alone", () => {
    const next = clone(base);
    next.condition = { metric: "spot_price", symbol: "btcusd", op: ">=", value: 64000 };
    if (next.action?.kind === "prediction_order") next.action.quantity = 50;
    const { move, undone } = guardEdit(base, next, "check");
    expect(move.condition).toBeDefined();
    expect(move.action).toMatchObject({ quantity: 5 });
    expect(undone).toContain("the order");
  });

  it("editing one lookup can drop or change only that lookup", () => {
    const next = clone(base);
    next.research = [];
    if (next.action?.kind === "prediction_order") next.action.maxPrice = 0.9;
    const { move } = guardEdit(base, next, "r1");
    expect(move.research).toHaveLength(0);
    expect(move.action).toMatchObject({ maxPrice: 0.4 });
  });
});
