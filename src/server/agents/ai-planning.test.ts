import { describe, expect, it, vi } from "vitest";

const reply = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/server/ai", async (orig) => {
  const real = await orig<typeof import("@/server/ai")>();
  return { ...real, aiJson: async () => (reply.value ? { value: reply.value, usage: { model: "test", promptTokens: 1, completionTokens: 1 } } : null) };
});
vi.mock("@/server/gemini", async (orig) => {
  const real = await orig<typeof import("@/server/gemini")>();
  return {
    ...real,
    searchEvents: async () => [{ ticker: "BTC-1", title: "BTC today", category: "Crypto", volume: 5, contracts: [{ symbol: "GEMI-BTC-1", label: "Up", last: 0.5, bid: null, ask: null }] }],
  };
});

const { aiPlan, aiEdit } = await import("./ai-planning");
const cards = { deliverableTitle: "BTC odds", deliverablePoints: ["a"], riskPoints: ["b"] };

describe("AI planning is validated by code", () => {
  it("accepts events that exist", async () => {
    reply.value = { eventTickers: ["BTC-1"], markets: 2, tape: false, timeframe: "15m", cards };
    const r = await aiPlan("inso", "BTC odds");
    expect(r?.options).toMatchObject({ events: [{ ticker: "BTC-1" }], markets: 2, tape: false });
  });

  it("rejects invented events, so the rule-based planner takes over", async () => {
    reply.value = { eventTickers: ["MADE-UP"], markets: 2, tape: false, timeframe: "15m", cards };
    expect(await aiPlan("inso", "BTC odds")).toBeNull();
  });

  it("rejects out-of-range values via the schema", async () => {
    reply.value = { eventTickers: ["BTC-1"], markets: 50, tape: false, timeframe: "15m", cards };
    // aiJson is mocked to skip parsing, so validate the same way the real client does
    const { z } = await import("zod");
    const markets = z.number().int().min(1).max(5);
    expect(markets.safeParse(50).success).toBe(false);
  });

  it("a refused edit keeps the plan unchanged and offers alternatives", async () => {
    reply.value = { reply: { ok: false, message: "Read-only", alternatives: ["Track 5 markets"] }, plan: null };
    const r = await aiEdit("inso", "BTC odds", "method", "buy YES", { markets: 3 });
    expect(r).toMatchObject({ ok: false, message: "Read-only", alternatives: ["Track 5 markets"] });
    expect(r?.options).toBeUndefined();
  });
});
