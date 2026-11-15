import { describe, expect, it, vi } from "vitest";

process.env.GEMINI_TRADING_KEY = "test-key";
process.env.GEMINI_TRADING_SECRET = "test-secret";
delete process.env.GEMINI_TRADING_ENV;

const calls: string[] = [];
let active: { orderId: number }[] = [];
vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  const u = new URL(url);
  calls.push(`${init?.method ?? "GET"} ${u.pathname}`);
  const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
  switch (u.pathname) {
    case "/v1/prediction-markets/terms/status":
      return json({ hasAcceptedLatest: true });
    case "/v1/balances":
      return json([{ currency: "USD", available: "100" }]);
    case "/v1/prediction-markets/positions":
      return json({ positions: [] });
    case "/v1/prediction-markets/events":
      return json({ data: [{ ticker: "BTC-1", title: "BTC today", category: "Crypto", volume: 1, contracts: [{ instrumentSymbol: "GEMI-BTC-1", label: "Up", status: "active", prices: {} }] }] });
    case "/v1/prediction-markets/order":
      active = [{ orderId: 77 }];
      return json({ orderId: 77, status: "open" });
    case "/v1/prediction-markets/order/cancel":
      active = [];
      return json({ result: "ok" });
    case "/v1/prediction-markets/orders/active":
      return json({ orders: active });
  }
  return new Response("{}", { status: 404 });
});

const { selfTest } = await import("./exchange");

describe("test-exchange connection check", () => {
  it("places a 1¢ order, then cancels it, leaving nothing open", async () => {
    const steps = await selfTest();
    expect(steps.map((s) => [s.step, s.ok])).toEqual([
      ["Keys", true],
      ["Terms", true],
      ["Balance", true],
      ["Positions", true],
      ["Market", true],
      ["Place", true],
      ["Cancel", true],
    ]);
    expect(calls).toContain("POST /v1/prediction-markets/order/cancel");
  });
});
