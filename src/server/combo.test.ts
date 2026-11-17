import { afterAll, describe, expect, it, vi } from "vitest";
import { settle } from "@/lib/settle";
import type { MoveAction, OrderResult } from "@/lib/types";

vi.mock("@/server/agents/ai-planning", async (orig) => ({ ...(await orig<typeof import("@/server/agents/ai-planning")>()), spotSymbols: async () => ["btcusd", "ethusd"] }));

const later = new Date(Date.now() + 86_400_000).toISOString();
const contract = (event: string, id: string, label: string, bid: number, ask: number, over: Record<string, unknown> = {}) => ({ id: `1-${id}`, label, instrumentSymbol: `GEMI-${event}-${id}`, prices: { bestBid: String(bid), bestAsk: String(ask), lastTradePrice: String(ask) }, status: "active", marketState: "open", expiryDate: later, ...over });
const EVENTS: Record<string, unknown> = {
  BTC: { ticker: "BTC", title: "BTC price tomorrow", category: "Crypto", contracts: [contract("BTC", "HI65000", "$65,000 or above", 0.38, 0.4), contract("BTC", "HI66000", "$66,000 or above", 0.18, 0.2)] },
  OIL: { ticker: "OIL", title: "Oil price tomorrow", category: "Commodities", contracts: [contract("OIL", "HI100", "$100 or above", 0.48, 0.5)] },
  GAME: { ticker: "GAME", title: "Lakers vs Suns", category: "Sports", contracts: [contract("GAME", "LAL", "Lakers", 0.5, 0.55), contract("GAME", "PHX", "Suns", 0.45, 0.5)] },
};
vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string) => {
    const m = String(url).match(/\/events\/([A-Z]+)$/);
    const e = m && EVENTS[m[1]];
    return e ? new Response(JSON.stringify(e), { status: 200 }) : new Response("{}", { status: 404 });
  }),
);
afterAll(() => vi.unstubAllGlobals());

const { validateProposal, FREE_TOOLS } = await import("./tools");
const leg = (e: string, id: string, side: "yes" | "no" = "yes") => ({ eventTicker: e, symbol: `GEMI-${e}-${id}`, side });
const combo = (legs: ReturnType<typeof leg>[], over: Record<string, unknown> = {}) => ({
  title: "Cover: BTC and oil both up",
  why: "Both would hurt together",
  ask: "Buy cover that pays if both happen?",
  research: [],
  action: { kind: "prediction_order", eventTicker: "COMBO", symbol: "COMBO", label: "x", side: "yes", orderType: "limit", maxPrice: 0.22, stopPrice: null, quantity: 5, combo: legs },
  condition: null,
  budgetUsd: null,
  ...over,
});

describe("a combination is one order that pays only if every leg happens", () => {
  it("prices it as the legs multiplied, and says what they cost apart", async () => {
    const q = await FREE_TOOLS.combo_quote.run({ legs: [leg("BTC", "HI65000"), leg("OIL", "HI100")] });
    expect(q.data).toMatchObject({ fairPrice: 0.2, legsBoughtSeparately: 0.9 });
    expect(q.summary).toContain("20¢");
  });

  it("builds the order with each leg read from the exchange, never from the model", async () => {
    const r = await validateProposal("inso", combo([leg("BTC", "HI65000"), leg("OIL", "HI100", "no")]), "c1");
    if (!("proposal" in r)) throw new Error(r.error);
    const a = r.proposal.action as Extract<MoveAction, { kind: "prediction_order" }>;
    expect(a.combo?.legs.map((l) => [l.label, l.side, l.price, l.contractId])).toEqual([
      ["$65,000 or above", "yes", 0.4, "HI65000"],
      // NO costs one minus what YES sells for.
      ["$100 or above", "no", 0.52, "HI100"],
    ]);
    expect(a.combo?.fair).toBe(0.21);
    expect(r.proposal.adjustments?.join(" ")).toMatch(/only if all 2 happen/);
  });

  it("sizes cover so the payout covers the loss", async () => {
    const r = await validateProposal("inso", combo([leg("BTC", "HI65000"), leg("OIL", "HI100")], { hedge: { protects: "a bad week", lossUsd: 20 } }), "c2");
    if (!("proposal" in r)) throw new Error(r.error);
    // 20 / (1 − 0.22) rounds up to 26 contracts: $5.72 for $26 of cover.
    expect(r.proposal.action).toMatchObject({ quantity: 26 });
    expect(r.proposal.hedge).toMatchObject({ payout: 26, cost: 5.72 });
  });

  it("refuses legs that can't both happen, repeats, and made-up contracts", async () => {
    expect(await validateProposal("inso", combo([leg("GAME", "LAL"), leg("GAME", "PHX")]), "c3")).toMatchObject({ error: expect.stringContaining("both can't be YES") });
    expect(await validateProposal("inso", combo([leg("BTC", "HI65000"), leg("BTC", "HI65000")]), "c4")).toMatchObject({ error: expect.stringContaining("different contract") });
    expect(await validateProposal("inso", combo([leg("BTC", "HI65000"), leg("NOPE", "X")]), "c5")).toMatchObject({ error: expect.stringContaining("not found") });
    // Two rungs of one price ladder can both be true, so that pair is allowed.
    expect(await validateProposal("inso", combo([leg("BTC", "HI65000"), leg("BTC", "HI66000")]), "c6")).toHaveProperty("proposal");
  });
});

describe("what a position paid once its market resolved", () => {
  const single: MoveAction = { kind: "prediction_order", eventTicker: "BTC", symbol: "S", label: "Up", side: "yes", orderType: "limit", maxPrice: 0.4, quantity: 10 };
  const filled: OrderResult = { venue: "gemini-sandbox", status: "filled", detail: "", notional: 4, filledQuantity: 10, avgPrice: 0.38 };
  const practice: OrderResult = { venue: "paper", status: "simulated", detail: "", notional: 4 };

  it("pays $1 a contract when it resolved your way, nothing otherwise", () => {
    expect(settle(single, filled, () => "yes")).toMatchObject({ won: true, paid: 10, cost: 3.8, practice: false });
    expect(settle(single, filled, () => "no")).toMatchObject({ won: false, paid: 0, cost: 3.8 });
    expect(settle({ ...single, side: "no" }, filled, () => "no")).toMatchObject({ won: true, paid: 10 });
  });

  it("waits while undecided, and has nothing to say when nothing was held", () => {
    expect(settle(single, filled, () => undefined)).toBeUndefined();
    expect(settle(single, { ...filled, status: "cancelled", filledQuantity: 0 }, () => "yes")).toBeUndefined();
    expect(settle({ ...single, trade: "sell" }, filled, () => "yes")).toBeUndefined();
  });

  it("a practice order shows what it would have been, at the limit price", () => {
    expect(settle(single, practice, () => "yes")).toMatchObject({ won: true, paid: 10, cost: 4, practice: true });
  });

  it("a combination loses as soon as one leg misses and wins only when all are in", () => {
    const legs = [
      { eventTicker: "A", symbol: "a", label: "A", event: "", side: "yes" as const, price: 0.5 },
      { eventTicker: "B", symbol: "b", label: "B", event: "", side: "no" as const, price: 0.5 },
    ];
    const c: MoveAction = { ...single, symbol: "COMBO", combo: { legs, fair: 0.25 } };
    expect(settle(c, practice, (s) => (s === "a" ? "no" : undefined))).toMatchObject({ won: false, paid: 0 });
    expect(settle(c, practice, (s) => (s === "a" ? "yes" : undefined))).toBeUndefined();
    expect(settle(c, practice, (s) => (s === "a" ? "yes" : "no"))).toMatchObject({ won: true, paid: 10, resolved: "yes" });
  });
});
