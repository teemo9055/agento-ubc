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
  action: { kind: "prediction_order", eventTicker: "BTC-1", symbol: "GEMI-BTC-1", label: "Up", side: "yes", maxPrice: 0.52, quantity: 5 },
  condition: { metric: "yes_price", symbol: "GEMI-BTC-1", op: "<=", value: 0.52 },
  ...over,
});

describe("moves are validated by code, whoever wrote them", () => {
  it("accepts a move on a real contract", async () => {
    const r = await validateProposal("inso", move(), "p1");
    expect("proposal" in r && r.proposal.research[0]).toMatchObject({ id: "r1", tool: "odds_history" });
  });

  it("rejects invented contracts", async () => {
    const r = await validateProposal("inso", move({ action: { kind: "prediction_order", eventTicker: "MADE-UP", symbol: "X", label: "x", side: "yes", maxPrice: 0.5, quantity: 1 } }), "p2");
    expect(r).toMatchObject({ error: expect.stringContaining("not found") });
  });

  it("rejects moves the agent isn't allowed to make", async () => {
    const r = await validateProposal("travo", move(), "p3");
    expect(r).toMatchObject({ error: expect.stringContaining("can't do") });
  });

  it("caps order size", async () => {
    const r = await validateProposal("inso", move({ action: { kind: "prediction_order", eventTicker: "BTC-1", symbol: "GEMI-BTC-1", label: "Up", side: "yes", maxPrice: 0.9, quantity: 100 } }), "p4");
    expect(r).toMatchObject({ error: expect.stringContaining("limit") });
  });

  it("rejects out-of-range prices via the schema", async () => {
    const r = await validateProposal("inso", move({ action: { kind: "prediction_order", eventTicker: "BTC-1", symbol: "GEMI-BTC-1", label: "Up", side: "yes", maxPrice: 1.5, quantity: 1 } }), "p5");
    expect(r).toMatchObject({ error: expect.stringContaining("maxPrice") });
  });
});
