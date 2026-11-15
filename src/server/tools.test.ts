import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/gemini", async (orig) => {
  const real = await orig<typeof import("@/server/gemini")>();
  return {
    ...real,
    getEvent: async (t: string) => {
      if (t !== "BTC-1") throw new Error("404");
      return { ticker: "BTC-1", title: "BTC today", category: "Crypto", volume: 5, contracts: [{ symbol: "GEMI-BTC-1", label: "Up", last: 0.5, bid: 0.49, ask: 0.51 }] };
    },
  };
});

const { validateProposal } = await import("./tools");
const move = (over: Record<string, unknown> = {}) => ({
  title: "Buy YES: BTC up",
  why: "Coin flip with buyers stepping in",
  ask: "Buy 5 YES at 52¢ or less?",
  research: [{ tool: "odds_history", args: { symbol: "GEMI-BTC-1", tf: "15m" }, label: "Odds history", why: "trend" }],
  action: { kind: "prediction_order", eventTicker: "BTC-1", symbol: "GEMI-BTC-1", label: "Up", side: "yes", orderType: "limit", maxPrice: 0.52, stopPrice: null, quantity: 5 },
  condition: null,
  budgetUsd: null,
  ...over,
});

describe("moves are validated by code, whoever wrote them", () => {
  it("accepts a move on a real contract", async () => {
    const r = await validateProposal("inso", move(), "p1");
    expect("proposal" in r && r.proposal.research[0]).toMatchObject({ id: "r1", tool: "odds_history" });
  });

  it("rejects invented contracts", async () => {
    const r = await validateProposal("inso", move({ action: { kind: "prediction_order", eventTicker: "MADE-UP", symbol: "X", label: "x", side: "yes", orderType: "limit", stopPrice: null, maxPrice: 0.5, quantity: 1 } }), "p2");
    expect(r).toMatchObject({ error: expect.stringContaining("not found") });
  });

  it("rejects moves the agent isn't allowed to make", async () => {
    const r = await validateProposal("travo", move(), "p3");
    expect(r).toMatchObject({ error: expect.stringContaining("can't do") });
  });

  it("caps order size", async () => {
    const r = await validateProposal("inso", move({ action: { kind: "prediction_order", eventTicker: "BTC-1", symbol: "GEMI-BTC-1", label: "Up", side: "yes", orderType: "limit", stopPrice: null, maxPrice: 0.9, quantity: 100 } }), "p4");
    expect(r).toMatchObject({ error: expect.stringContaining("limit") });
  });

  it("enforces the user's budget by cutting quantity, and says so", async () => {
    const r = await validateProposal("inso", move({ budgetUsd: 2 }), "p6");
    if (!("proposal" in r)) throw new Error(r.error);
    expect(r.proposal.action).toMatchObject({ quantity: 3 }); // 3 × 52¢ = $1.56 ≤ $2
    expect(r.proposal.adjustments?.[0]).toMatch(/\$2/);
  });

  it("folds a check on the order's own price into the resting order", async () => {
    const r = await validateProposal("inso", move({ condition: { metric: "yes_price", symbol: "GEMI-BTC-1", op: "<=", value: 0.6 } }), "p7");
    if (!("proposal" in r)) throw new Error(r.error);
    expect(r.proposal.condition).toBeUndefined();
  });

  it("stop-limit buys must trigger at or above the last trade", async () => {
    const stop = (stopPrice: number) => move({ action: { kind: "prediction_order", eventTicker: "BTC-1", symbol: "GEMI-BTC-1", label: "Up", side: "yes", orderType: "stop-limit", maxPrice: 0.6, stopPrice, quantity: 2 } });
    expect(await validateProposal("inso", stop(0.4), "p8")).toMatchObject({ error: expect.stringContaining("below the last trade") });
    const ok = await validateProposal("inso", stop(0.55), "p9");
    expect("proposal" in ok && ok.proposal.action).toMatchObject({ orderType: "stop-limit", stopPrice: 0.55 });
  });

  it("without exchange keys every order is labelled a simulation", async () => {
    const r = await validateProposal("inso", move(), "p10");
    expect("proposal" in r && r.proposal.venue).toBe("paper");
  });

  it("rejects out-of-range prices via the schema", async () => {
    const r = await validateProposal("inso", move({ action: { kind: "prediction_order", eventTicker: "BTC-1", symbol: "GEMI-BTC-1", label: "Up", side: "yes", orderType: "limit", stopPrice: null, maxPrice: 1.5, quantity: 1 } }), "p5");
    expect(r).toMatchObject({ error: expect.stringContaining("maxPrice") });
  });
});
