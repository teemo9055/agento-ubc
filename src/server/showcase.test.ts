import { describe, expect, it, vi } from "vitest";

const up = vi.hoisted(() => ({ botpay: true, market: true }));

vi.mock("@/server/agents/ai-planning", async (orig) => ({ ...(await orig<typeof import("@/server/agents/ai-planning")>()), spotSymbols: async () => ["btcusd"] }));
vi.mock("@/server/chain", async (orig) => {
  const real = await orig<typeof import("@/server/chain")>();
  return { ...real, addresses: { ...real.addresses, agent: "0x00000000000000000000000000000000000000a1" } };
});
vi.mock("@/server/gemini", async (orig) => {
  const real = await orig<typeof import("@/server/gemini")>();
  const event = { ticker: "BTC-1", title: "BTC on Nov 30", category: "Crypto", volume: 10, contracts: [{ symbol: "GEMI-BTC-A", label: "$65,000 or above", last: 0.5, bid: 0.49, ask: 0.51, open: true }] };
  return {
    ...real,
    spotTicker: async (symbol: string) => ({ symbol, last: 65200, bid: 65190, ask: 65210, change24h: 0.01, high24h: 66000, low24h: 64000 }),
    searchEvents: async () => (up.market ? [event] : []),
    getEvent: async () => event,
    recentTrades: async () => [],
  };
});
vi.mock("@/server/marketplace", async (orig) => {
  const real = await orig<typeof import("@/server/marketplace")>();
  const listing = { name: "BotPay /pay", provider: "BotPay", category: "INFRASTRUCTURE", description: "Paid receipt", resource: "https://api.botpay.network/pay", method: "GET" as const, priceUsd: 0.01, networks: ["eip155:5042002"], payableHere: true, payTo: "0x159BE9e316BC5faC8Ce05aec4eaAe46E8f8a4908" as const, amount: "10000" };
  return {
    ...real,
    findService: async () => (up.botpay ? listing : undefined),
    quoteService: async () => ({ amount: 10_000n, payTo: listing.payTo }),
  };
});

const { buildShowcase } = await import("./showcase");
const { planFromProposal } = await import("./agents/toolbox");

describe("the showcase workflow", () => {
  it("is ten real steps in stages, built without the model, for about six cents", async () => {
    const r = await buildShowcase("show1");
    if (!("plan" in r)) throw new Error(r.error);
    const steps = r.plan.steps;
    expect(steps.map((s) => [s.id, s.agent, s.after.join("+"), s.gate])).toEqual([
      ["s1", "trado", "", "done"],
      ["s2", "trado", "", "done"],
      ["s3", "inso", "", "done"],
      ["s4", "trado", "", "done"],
      ["s5", "trado", "", "done"],
      ["s6", "travo", "", "done"],
      ["s7", "inso", "s1+s3+s5", "filled"],
      ["s8", "trado", "s2", "done"],
      ["s9", "travo", "s6", "done"],
      ["s10", "inso", "s7", "done"],
    ]);
    expect(r.plan.unavailable).toEqual([]);
    // The bet spends the sale's proceeds and needs two sources above a floor a little under today's price.
    const bet = steps[6];
    expect(bet.useProceeds).toBe(true);
    expect(bet.proposal.condition).toEqual({ metric: "oracle_price", symbol: "btcusd", op: ">=", value: 63000 });
    expect(bet.proposal.also).toEqual([{ metric: "spot_price", symbol: "btcusd", op: ">=", value: 63000 }]);
    // Three sellers, and the whole thing costs cents.
    const lines = steps.flatMap((s) => planFromProposal(s.proposal).lines).filter((l) => l.rail !== "exchange");
    expect([...new Set(lines.map((l) => l.payeeName))].sort()).toEqual(["Agento data feed", "BotPay (Agent Marketplace)", "Quicknode (Agent Marketplace)"]);
    const cost = lines.reduce((a, l) => a + Number(l.approved), 0) / 1e6;
    expect(cost).toBeGreaterThan(0.05);
    expect(cost).toBeLessThan(0.08);
  });

  it("leaves out what can't run right now and says so, instead of failing", async () => {
    up.botpay = false;
    up.market = false;
    try {
      const r = await buildShowcase("show2");
      if (!("plan" in r)) throw new Error(r.error);
      expect(r.plan.steps.map((s) => s.proposal.title)).not.toContain("Pay a second vendor: BotPay receipt");
      expect(r.plan.steps.some((s) => s.proposal.action?.kind === "prediction_order")).toBe(false);
      expect(r.plan.unavailable.map((u) => u.what)).toEqual(["Pay a second vendor: BotPay receipt", "The BTC bet"]);
      // What's left still hangs together: nothing waits on a step that isn't there.
      const ids = new Set(r.plan.steps.map((s) => s.id));
      expect(r.plan.steps.every((s) => s.after.every((a) => ids.has(a)))).toBe(true);
    } finally {
      up.botpay = true;
      up.market = true;
    }
  });
});
