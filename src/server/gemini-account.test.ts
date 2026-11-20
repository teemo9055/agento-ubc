import { afterEach, describe, expect, it, vi } from "vitest";
import { contractName } from "@/lib/contract-name";

describe("your Gemini prediction account", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("names a contract in plain words", () => {
    expect(contractName("GEMI-BTC2611272200-HI63500")).toBe("BTC · Nov 27 · $63,500 or above");
    expect(contractName("GEMI-BTC15M2611201500-UP")).toBe("BTC · Nov 20 · Up");
    expect(contractName("SOMETHING-ELSE")).toBe("SOMETHING-ELSE");
  });

  it("reads open orders, positions and fills from Gemini's prediction-market API", async () => {
    vi.stubEnv("GEMINI_SANDBOX_KEY", "k");
    vi.stubEnv("GEMINI_SANDBOX_SECRET", "s");
    const answers: Record<string, unknown> = {
      "/v1/prediction-markets/orders/active": { orders: [{ orderId: 101, symbol: "GEMI-BTC2611272200-HI63500", side: "buy", outcome: "yes", price: "0.20", quantity: "19", filledQuantity: "0", status: "open", createdAt: "2026-11-20T15:00:00Z" }] },
      "/v1/prediction-markets/positions": { positions: [{ symbol: "GEMI-BRENT2611202200-HI80", totalQuantity: "46", avgPrice: "0.45", outcome: "yes", contractMetadata: { contractName: "$80 or above" } }] },
      "/v1/prediction-markets/orders/history": { orders: [{ orderId: 99, symbol: "GEMI-BRENT2611202200-HI80", side: "buy", outcome: "yes", price: "0.45", quantity: "46", filledQuantity: "46", status: "filled", createdAt: "2026-11-19T16:00:00Z" }] },
    };
    vi.stubGlobal("fetch", async (url: string) => {
      const path = new URL(url).pathname;
      return new Response(JSON.stringify(answers[path] ?? {}), { status: 200, headers: { "content-type": "application/json" } });
    });
    const { predictionAccount, withVenue } = await import("./exchange");
    const a = await withVenue("gemini-sandbox", () => predictionAccount());
    expect(a.error).toBeUndefined();
    expect(a.openOrders).toEqual([expect.objectContaining({ orderId: "101", symbol: "GEMI-BTC2611272200-HI63500", price: 0.2, quantity: 19, filled: 0 })]);
    expect(a.positions[0]).toMatchObject({ symbol: "GEMI-BRENT2611202200-HI80", quantity: 46 });
    expect(a.recent[0]).toMatchObject({ orderId: "99", filled: 46 });
  });
});

describe("which Gemini account Agento trades on", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const serve = (answers: Record<string, unknown>, sent: Record<string, unknown>[] = []) =>
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      const payload = JSON.parse(Buffer.from(String((init?.headers as Record<string, string>)["x-gemini-payload"]), "base64").toString());
      sent.push(payload);
      const a = answers[path];
      return a === undefined ? new Response(JSON.stringify({ result: "error", message: "not allowed" }), { status: 403 }) : new Response(JSON.stringify(a), { status: 200 });
    });

  it("an account key: names the account it trades on", async () => {
    vi.stubEnv("GEMINI_SANDBOX_KEY", "k");
    vi.stubEnv("GEMINI_SANDBOX_SECRET", "s");
    serve({
      "/v1/account": { account: { accountName: "Bot account", shortName: "botaccount", type: "exchange" } },
      "/v1/prediction-markets/terms/status": { hasAcceptedLatest: true },
      "/v1/prediction-markets/orders/active": { orders: [] },
      "/v1/prediction-markets/positions": { positions: [] },
      "/v1/prediction-markets/orders/history": { orders: [{ orderId: 7, symbol: "GEMI-BTC2611272200-HI63500", outcome: "yes", side: "buy", price: "0.2", quantity: "19", filledQuantity: "0", status: "open", createdAt: "2026-11-20T15:00:00Z" }] },
    });
    const { accountCheck, withVenue } = await import("./exchange");
    const c = await withVenue("gemini-sandbox", () => accountCheck());
    expect(c.masterKey).toBe(false);
    expect(c.account).toEqual({ name: "Bot account", shortName: "botaccount", type: "exchange" });
    expect(c.termsAccepted).toBe(true);
    expect(c.recent[0]).toMatchObject({ orderId: "7", quantity: 19 });
  });

  it("a master key: lists its accounts, and once one is set every request names it", async () => {
    vi.stubEnv("GEMINI_SANDBOX_KEY", "k");
    vi.stubEnv("GEMINI_SANDBOX_SECRET", "s");
    const sent: Record<string, unknown>[] = [];
    serve({ "/v1/account/list": [{ name: "Primary", account: "primary", type: "exchange" }, { name: "Testing", account: "testing" }] }, sent);
    const { accountCheck, withVenue } = await import("./exchange");
    const c = await withVenue("gemini-sandbox", () => accountCheck());
    expect(c.masterKey).toBe(true);
    expect(c.accounts).toEqual([
      { name: "Primary", shortName: "primary" },
      { name: "Testing", shortName: "testing" },
    ]);
    expect(c.error).toMatch(/master key/);
    vi.stubEnv("GEMINI_SANDBOX_ACCOUNT", "primary");
    sent.length = 0;
    await withVenue("gemini-sandbox", () => accountCheck());
    expect(sent.every((p) => p.account === "primary")).toBe(true);
  });
});
