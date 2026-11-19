import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The SDK's server kit is mocked: no request ever leaves the test.
const kitOptions: unknown[] = [];
const handled: unknown[] = [];
vi.mock("@circle-fin/onramp-kit/server", () => ({
  createOnrampServerKit: (opts: unknown) => {
    kitOptions.push(opts);
    return { createSession: vi.fn() };
  },
  createSessionRouteHandler: () => async (req: Request) => {
    handled.push(await req.json());
    return Response.json({ sessionId: "s1", sessionToken: "t1", widgetUrl: "https://onramp-sandbox.arc.io/?t=t1", expiresAt: new Date(Date.now() + 60_000).toISOString() });
  },
}));

const { mintOnrampSession, resetOnrampLimits, MAINNET_KEY_MISSING } = await import("./onramp");

const ADDR = "0x000000000000000000000000000000000000dEaD";
const post = (body: unknown, ip = "1.2.3.4") =>
  mintOnrampSession(new Request("http://localhost/api/onramp/sessions", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }));

describe("onramp session route", () => {
  beforeEach(() => {
    kitOptions.length = 0;
    handled.length = 0;
    resetOnrampLimits();
    vi.stubEnv("CIRCLE_API_KEY", "TEST_API_KEY:fake:fake");
    vi.stubEnv("CIRCLE_MAINNET_API_KEY", "");
    vi.stubEnv("APP_PUBLIC_URL", "https://agento.example.com/");
    vi.stubEnv("ONRAMP_SANDBOX_API_URL", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuses a bad address with 400", async () => {
    const res = await post({ network: "testnet", destinationAddress: "0x1234", appUserId: "u_abcdef12" });
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(kitOptions).toHaveLength(0);
  });

  it("refuses a missing network or user id with 400", async () => {
    expect((await post({ destinationAddress: ADDR, appUserId: "u_abcdef12" })).status).toBe(400);
    expect((await post({ network: "testnet", destinationAddress: ADDR, appUserId: "me" })).status).toBe(400);
    expect((await post({ network: "devnet", destinationAddress: ADDR, appUserId: "u_abcdef12" })).status).toBe(400);
  });

  it("refuses mainnet with 503 when the production key isn't set, and never falls back to the sandbox key", async () => {
    const res = await post({ network: "mainnet", destinationAddress: ADDR, appUserId: "u_abcdef12" });
    expect(res.status).toBe(503);
    expect((await res.json()).message).toBe(MAINNET_KEY_MISSING);
    expect(kitOptions).toHaveLength(0);
  });

  it("builds a sandbox session for testnet with the test key", async () => {
    const res = await post({ network: "testnet", destinationAddress: ADDR, appUserId: "u_abcdef12" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).sessionToken).toBe("t1");
    expect(kitOptions[0]).toMatchObject({
      apiKey: "TEST_API_KEY:fake:fake",
      widgetBaseUrl: "https://onramp-sandbox.arc.io",
      baseUrl: "https://api-test.circle.com",
      referrerDomain: "agento.example.com",
    });
    expect(handled[0]).toMatchObject({ appUserId: "u_abcdef12", destinationAddress: ADDR, assets: { pairs: [{ token: "USDC", chain: "arc" }] } });
    expect(handled[0]).not.toHaveProperty("network");
  });

  it("uses the production widget and key for mainnet when it is set", async () => {
    vi.stubEnv("CIRCLE_MAINNET_API_KEY", "LIVE_API_KEY:fake:fake");
    const res = await post({ network: "mainnet", destinationAddress: ADDR, appUserId: "u_abcdef12" });
    expect(res.status).toBe(200);
    expect(kitOptions[0]).toMatchObject({ apiKey: "LIVE_API_KEY:fake:fake", widgetBaseUrl: "https://onramp.arc.io" });
    expect(kitOptions[0]).not.toHaveProperty("baseUrl");
  });

  it("limits each IP to 10 sessions a minute", async () => {
    const body = { network: "testnet", destinationAddress: ADDR, appUserId: "u_abcdef12" };
    for (let i = 0; i < 10; i++) expect((await post(body, "9.9.9.9")).status).toBe(200);
    expect((await post(body, "9.9.9.9")).status).toBe(429);
    expect((await post(body, "8.8.8.8")).status).toBe(200);
  });
});
