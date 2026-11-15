import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/agents/ai-planning", async (orig) => ({ ...(await orig<typeof import("@/server/agents/ai-planning")>()), spotSymbols: async () => ["btcusd"] }));
vi.mock("@/server/gemini", async (orig) => {
  const real = await orig<typeof import("@/server/gemini")>();
  const now = Date.now();
  return {
    ...real,
    getEvent: async () => ({
      ticker: "BTC-1",
      title: "BTC today",
      category: "Crypto",
      volume: 5,
      contracts: [
        { symbol: "GEMI-BTC-1", label: "Up", last: 0.6, bid: 0.58, ask: 0.62, open: true },
        { symbol: "GEMI-BTC-2", label: "Higher", last: 0.2, bid: 0.19, ask: 0.21, open: true },
      ],
    }),
    // BTC-1 moved 30¢ today, BTC-2 only 2¢.
    oddsHistory: async (sym: string) =>
      sym === "GEMI-BTC-1"
        ? [{ t: now - 3_600_000 * 5, p: 0.3 }, { t: now - 3_600_000, p: 0.6 }]
        : [{ t: now - 3_600_000 * 5, p: 0.2 }, { t: now - 3_600_000, p: 0.22 }],
  };
});
vi.mock("@/server/exchange", async (orig) => {
  const real = await orig<typeof import("@/server/exchange")>();
  const held = [
    { symbol: "GEMI-BTC-1", eventTicker: "BTC-1", label: "Up", event: "BTC today", outcome: "yes", quantity: 10, available: 10, avgPrice: 0.4, sellPrice: 0.58, marketValue: 5.8, unrealizedPnl: 1.8 },
    { symbol: "GEMI-BTC-2", eventTicker: "BTC-1", label: "Higher", event: "BTC today", outcome: "yes", quantity: 4, available: 0, avgPrice: 0.25, sellPrice: 0.19, marketValue: 0.76, unrealizedPnl: -0.24 },
  ];
  return { ...real, tradingVenue: () => "gemini-sandbox", positions: async () => ({ venue: "gemini-sandbox", positions: held }) };
});

const { validateProposal, runFreeTool } = await import("./tools");
const sell = (over: Record<string, unknown> = {}) => ({
  title: "Sell BTC Up",
  why: "Take the profit",
  ask: "Sell 10 YES at 58¢ or more?",
  research: [],
  action: { kind: "prediction_order", eventTicker: "BTC-1", symbol: "GEMI-BTC-1", label: "Up", side: "yes", trade: "sell", orderType: "limit", maxPrice: 0.58, stopPrice: null, quantity: 10, ...over },
  condition: null,
  budgetUsd: null,
});

describe("selling what you hold", () => {
  it("lists positions calmest first, with how much each swung today", async () => {
    const r = await runFreeTool("my_positions", {});
    const list = (r.data as { positions: { symbol: string; swing24h: number }[] }).positions;
    expect(list.map((p) => [p.symbol, p.swing24h])).toEqual([
      ["GEMI-BTC-2", 2],
      ["GEMI-BTC-1", 30],
    ]);
  });

  it("a sell at the best bid sells now, spends nothing and states the profit", async () => {
    const r = await validateProposal("inso", sell(), "s1");
    if (!("proposal" in r)) throw new Error(r.error);
    expect(r.proposal.action).toMatchObject({ trade: "sell", quantity: 10, maxPrice: 0.58 });
    expect(r.proposal.adjustments?.join(" | ")).toMatch(/Sells now: best buyer pays 58¢/);
    expect(r.proposal.adjustments?.join(" | ")).toMatch(/locks in about \$1\.80/);
    const { notionalOf } = await import("./exchange");
    expect(notionalOf(r.proposal.action!)).toBe(0);
  });

  it("never sells more than is held", async () => {
    const r = await validateProposal("inso", sell({ quantity: 50 }), "s2");
    expect("proposal" in r && r.proposal.action).toMatchObject({ quantity: 10 });
  });

  it("refuses to sell what isn't held or is on hold", async () => {
    const none = await validateProposal("inso", sell({ side: "no" }), "s3");
    expect("error" in none && none.error).toMatch(/holds no NO/);
    const onHold = await validateProposal("inso", sell({ symbol: "GEMI-BTC-2", label: "Higher" }), "s4");
    expect("error" in onHold && onHold.error).toMatch(/on hold/);
  });

  it("sells are plain limit orders", async () => {
    const r = await validateProposal("inso", sell({ orderType: "stop-limit", stopPrice: 0.6, maxPrice: 0.61 }), "s5");
    expect("error" in r && r.error).toMatch(/limit/);
  });
});
