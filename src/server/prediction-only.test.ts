import { describe, expect, it } from "vitest";
import { ACTIONS, validateProposal } from "./tools";
import { describeAction, placeOrder } from "./exchange";

describe("only prediction-market orders go to Gemini", () => {
  it("no agent may propose a coin (spot) order unless it is switched on", async () => {
    delete process.env.SPOT_ORDERS;
    expect(Object.values(ACTIONS).flat()).not.toContain("spot_order");
    const r = await validateProposal("trado", { title: "Buy BTC", why: "dip", ask: "Buy $10 of BTC?", research: [], action: { kind: "spot_order", symbol: "btcusd", side: "buy", limitPrice: 60000, amountUsd: 10 }, condition: null, budgetUsd: 10 }, "p1");
    expect("error" in r && r.error).toMatch(/can't do spot_order|Only prediction-market orders/);
  });

  it("a coin order from an old saved job is refused before it reaches Gemini", async () => {
    delete process.env.SPOT_ORDERS;
    process.env.GEMINI_SANDBOX_KEY = "k";
    process.env.GEMINI_SANDBOX_SECRET = "s";
    const { withVenue } = await import("./exchange");
    await expect(withVenue("gemini-sandbox", () => placeOrder({ kind: "spot_order", symbol: "btcusd", side: "buy", limitPrice: 60000, amountUsd: 10 }))).rejects.toThrow(/Only prediction-market orders/);
    delete process.env.GEMINI_SANDBOX_KEY;
    delete process.env.GEMINI_SANDBOX_SECRET;
  });

  it("orders are described as prediction orders", () => {
    expect(describeAction({ kind: "prediction_order", eventTicker: "E", symbol: "GEMI-X", label: "$70,000 or above", side: "yes", orderType: "limit", maxPrice: 0.4, quantity: 5 })).toMatch(/^Prediction order: 5 × YES/);
  });
});

describe("placing a held order anyway", () => {
  it("is offered only for a finished buy whose order didn't go in", async () => {
    const { canPlaceAnyway } = await import("./orchestrator");
    const action = { kind: "prediction_order", eventTicker: "E", symbol: "GEMI-X", label: "x", side: "yes", orderType: "limit", maxPrice: 0.2, quantity: 5 };
    const base = { status: "done", proposal: { action }, phases: [{ id: "act", status: "skipped" }] } as never;
    expect(canPlaceAnyway(base)).toBe(true);
    expect(canPlaceAnyway({ ...(base as object), order: { status: "skipped" }, phases: [{ id: "act", status: "done" }] } as never)).toBe(true);
    expect(canPlaceAnyway({ ...(base as object), order: { status: "open" }, phases: [{ id: "act", status: "done" }] } as never)).toBe(false);
    expect(canPlaceAnyway({ ...(base as object), status: "running" } as never)).toBe(false);
  });
});
