import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";

vi.mock("./gemini", async (orig) => {
  const real = await orig<typeof import("./gemini")>();
  return {
    ...real,
    getEvent: vi.fn(async (ticker: string) => ({ ticker, title: "BTC at 5pm", category: "Crypto", volume: 1, source: "LS-LRRR-XBTUSD", contracts: [{ symbol: "GEMI-X-HI65000", label: "$65,000 or above", last: 0.4, bid: 0.38, ask: 0.42, strike: 65000, expiry: "2030-01-01T00:00:00Z" }] })),
    spotTicker: vi.fn(async (symbol: string) => ({ symbol, last: 64800, bid: null, ask: null, change24h: null, high24h: null, low24h: null })),
  };
});

afterEach(() => vi.unstubAllEnvs());

describe("live prices", () => {
  it("reads a contract with its strike and the price it is measured against", async () => {
    vi.stubEnv("LIVE_STREAM", "off");
    const { snapshot } = await import("./live");
    const [t] = await snapshot([{ eventTicker: "X", symbol: "GEMI-X-HI65000" }]);
    expect(t).toMatchObject({ bid: 0.38, ask: 0.42, strike: 65000, spot: 64800, spotSymbol: "btcusd", via: "poll" });
  });

  it("maps settlement indexes to spot symbols", async () => {
    const { spotOfSource } = await import("./gemini");
    expect(spotOfSource("LS-LRRR-XBTUSD")).toBe("btcusd");
    expect(spotOfSource("LS-LRRR-SOLNUSD")).toBe("solusd");
    expect(spotOfSource("LS-LRRR-HYPE22USD")).toBe("hypeusd");
    expect(spotOfSource("KK_RFR_BRENTOILUSDC")).toBeUndefined();
  });

  it("subscribes on Gemini's stream and pushes a tick when the book changes", async () => {
    const server = new WebSocketServer({ port: 0 });
    const port = (server.address() as { port: number }).port;
    const got: string[] = [];
    server.on("connection", (ws) => {
      ws.on("message", (m) => {
        const req = JSON.parse(String(m));
        got.push(`${req.method} ${req.params.join(",")}`);
        ws.send(JSON.stringify({ id: req.id, status: 200, result: null }));
        if (req.method === "SUBSCRIBE") setTimeout(() => ws.send(JSON.stringify({ u: 1, E: 1, s: "GEMI-X-HI65000", b: "0.45", B: "10", a: "0.47", A: "10", c: "0.46" })), 30);
      });
    });
    vi.stubEnv("GEMINI_WS_URL", `ws://127.0.0.1:${port}`);
    vi.stubEnv("LIVE_STREAM", "on");
    vi.resetModules();
    const { follow } = await import("./live");
    const ticks: { bid: number | null; via: string }[] = [];
    const stop = follow([{ eventTicker: "X", symbol: "GEMI-X-HI65000" }], undefined, (t) => ticks.push({ bid: t[0].bid, via: t[0].via }));
    await vi.waitFor(() => expect(ticks.some((t) => t.via === "stream" && t.bid === 0.45)).toBe(true), { timeout: 3000 });
    expect(ticks[0]).toEqual({ bid: 0.38, via: "poll" });
    stop();
    await vi.waitFor(() => expect(got).toContain("UNSUBSCRIBE GEMI-X-HI65000@bookTicker"), { timeout: 2000 }).catch(() => undefined);
    expect(got[0]).toBe("SUBSCRIBE GEMI-X-HI65000@bookTicker");
    await new Promise<void>((r) => server.close(() => r()));
  });
});
