import { describe, expect, it } from "vitest";
import type { Proposal } from "@/lib/types";
import { diffMoves, guardEdit, readersOf } from "./move-diff";
import { brokenLinks, explainBroken } from "./step-links";

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
    expect(diffMoves(base, next)).toEqual(["+ Trade flow", "+ check: BTC price ≥ $64,000", "pays $5 → $10"]);
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

describe("changing a step that others use", () => {
  // r2 reads the phone number r1 finds; r3 stands alone.
  const svc = (id: string, url: string, extra: Partial<Proposal["research"][number]> = {}) => ({ id, tool: "service", args: { url, input: "{}" }, label: url, why: "", ...extra });
  const prev: Proposal = {
    ...base,
    action: undefined,
    research: [svc("r1", "https://a.test"), svc("r2", "https://b.test", { bind: { phone: "$r1.seller.phone" } }), svc("r3", "https://c.test")],
  };

  it("keeps every step in its place and lets the steps that read it follow the change", () => {
    // As the checked move comes back: numbered afresh, the edited step written last.
    const next = clone(prev);
    next.research = [svc("r1", "https://b.test", { bind: { phone: "$r3.contact.phone" } }), svc("r2", "https://c.test"), svc("r3", "https://z.test")];
    const { move, undone } = guardEdit(prev, next, "r1");
    expect(move.research.map((r) => [r.id, r.args.url])).toEqual([["r1", "https://z.test"], ["r2", "https://b.test"], ["r3", "https://c.test"]]);
    expect(move.research[1].bind).toEqual({ phone: "$r1.contact.phone" });
    expect(undone).toEqual([]);
    expect(diffMoves(prev, move)).toContain("https://b.test: uses the new answer");
  });

  it("puts back a step that doesn't use the changed one", () => {
    const next = clone(prev);
    next.research[2].args.url = "https://other.test";
    const { move, undone } = guardEdit(prev, next, "r1");
    expect(move.research[2].args.url).toBe("https://c.test");
    expect(undone).toEqual(["the other lookups"]);
  });

  it("names the step left without what it reads, in plain words", () => {
    const next = clone(prev);
    next.research = next.research.filter((r) => r.id !== "r1");
    const { move } = guardEdit(prev, next, "r1");
    const broken = brokenLinks(move);
    expect(broken).toMatchObject([{ step: "r2", from: "r1", why: "gone" }]);
    expect(explainBroken(broken).message).toBe("“https://b.test” uses the phone this step finds, so it can't stay without it.");
  });

  it("finds the steps that use an answer, directly or through another step", () => {
    const chain = [svc("r1", "a"), svc("r2", "b", { bind: { x: "$r1.x" } }), svc("r3", "c", { when: { ref: "$r2.y", op: "exists" } }), svc("r4", "d")];
    expect(readersOf(chain, "r1")).toEqual(["r2", "r3"]);
    expect(readersOf(chain, "r4")).toEqual([]);
  });
});
