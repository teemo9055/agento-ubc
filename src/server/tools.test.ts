import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/agents/ai-planning", async (orig) => ({ ...(await orig<typeof import("@/server/agents/ai-planning")>()), spotSymbols: async () => ["btcusd", "ethusd"] }));
vi.mock("@/server/gemini", async (orig) => {
  const real = await orig<typeof import("@/server/gemini")>();
  return {
    ...real,
    getEvent: async (t: string) => {
      if (t === "SOON-1") return { ticker: t, title: "Closing", category: "Crypto", volume: 5, contracts: [{ symbol: "GEMI-SOON-1", label: "Soon", last: 0.5, bid: 0.49, ask: 0.51, open: true, expiry: new Date(Date.now() + 5 * 60_000).toISOString() }] };
      if (t !== "BTC-1") throw new Error("404");
      return { ticker: "BTC-1", title: "BTC today", category: "Crypto", volume: 5, contracts: [{ symbol: "GEMI-BTC-1", label: "Up", last: 0.5, bid: 0.49, ask: 0.51, open: true }, { symbol: "GEMI-BTC-2", label: "Higher", last: 0.2, bid: 0.19, ask: 0.21, open: true }] };
    },
    // Trade data exists only for real contracts; anything else has nothing to buy.
    recentTrades: async (sym: string) => {
      if (!sym.startsWith("GEMI-BTC")) throw new Error("400 InvalidSymbol");
      return [];
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

  it("refuses contracts that close too soon for an order to rest", async () => {
    const r = await validateProposal("inso", move({ research: [], action: { kind: "prediction_order", eventTicker: "SOON-1", symbol: "GEMI-SOON-1", label: "Soon", side: "yes", orderType: "limit", maxPrice: 0.5, stopPrice: null, quantity: 1 } }), "p11");
    expect(r).toMatchObject({ error: expect.stringContaining("too soon") });
  });

  it("says whether a limit order fills now or waits on the book", async () => {
    const now = await validateProposal("inso", move(), "p12"); // 52¢ ≥ 51¢ ask
    expect("proposal" in now && now.proposal.adjustments?.join(" ")).toMatch(/Fills now/);
    const wait = await validateProposal("inso", move({ action: { kind: "prediction_order", eventTicker: "BTC-1", symbol: "GEMI-BTC-1", label: "Up", side: "yes", orderType: "limit", maxPrice: 0.4, stopPrice: null, quantity: 2 } }), "p13");
    expect("proposal" in wait && wait.proposal.adjustments?.join(" ")).toMatch(/Waits on the book/);
  });

  it("never charges for research on a symbol with no data", async () => {
    const r = await validateProposal("inso", move({ research: [{ tool: "trade_tape", args: { symbol: "GEMI-MADEUP" }, label: "Tape", why: "x" }] }), "p14");
    expect(r).toMatchObject({ error: expect.stringContaining("no live market data") });
  });

  it("only accepts conditions it can read before placing", async () => {
    const other = await validateProposal("inso", move({ condition: { metric: "yes_price", symbol: "GEMI-ELSEWHERE", op: ">=", value: 0.3 } }), "p15");
    expect(other).toMatchObject({ error: expect.stringContaining("same event") });
    const sibling = await validateProposal("inso", move({ condition: { metric: "yes_price", symbol: "GEMI-BTC-2", op: "<=", value: 0.3 } }), "p16");
    expect("proposal" in sibling && sibling.proposal.condition).toMatchObject({ symbol: "GEMI-BTC-2" });
    const spot = await validateProposal("inso", move({ condition: { metric: "spot_price", symbol: "BTCUSD", op: ">=", value: 60000 } }), "p17");
    expect("proposal" in spot && spot.proposal.condition).toMatchObject({ symbol: "btcusd" });
  });

  it("each agent only buys from its own toolkit", async () => {
    const r = await validateProposal("trado", move({ research: [{ tool: "trade_tape", args: { symbol: "GEMI-BTC-1" }, label: "Tape", why: "x" }] }), "p18");
    expect(r).toMatchObject({ error: expect.stringContaining("can't buy trade_tape") });
  });

  it("an oracle condition needs the oracle bought first", async () => {
    const r = await validateProposal("inso", move({ condition: { metric: "oracle_price", symbol: "btcusd", op: ">=", value: 60000 } }), "p19");
    expect(r).toMatchObject({ error: expect.stringContaining("oracle_price research step") });
    const ok = await validateProposal("inso", move({ research: [{ tool: "oracle_price", args: { symbol: "BTCUSD" }, label: "Chainlink", why: "check" }], condition: { metric: "oracle_price", symbol: "btcusd", op: ">=", value: 60000 } }), "p20");
    expect("proposal" in ok && ok.proposal.condition).toMatchObject({ metric: "oracle_price" });
  });

  it("never buys the same lookup twice", async () => {
    const twice = [{ tool: "oracle_price", args: { symbol: "btcusd" }, label: "Chainlink", why: "a" }, { tool: "oracle_price", args: { symbol: "BTCUSD" }, label: "Chainlink again", why: "b" }];
    const r = await validateProposal("inso", move({ research: twice }), "p21");
    if (!("proposal" in r)) throw new Error(r.error);
    expect(r.proposal.research).toHaveLength(1);
    expect(r.proposal.adjustments?.join(" ")).toMatch(/not buying it twice/);
  });

  it("rejects out-of-range prices via the schema", async () => {
    const r = await validateProposal("inso", move({ action: { kind: "prediction_order", eventTicker: "BTC-1", symbol: "GEMI-BTC-1", label: "Up", side: "yes", orderType: "limit", stopPrice: null, maxPrice: 1.5, quantity: 1 } }), "p5");
    expect(r).toMatchObject({ error: expect.stringContaining("maxPrice") });
  });
});
