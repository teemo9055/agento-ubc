import { describe, expect, it } from "vitest";
import type { MoveAction, OrderResult } from "@/lib/types";
import { followsLive, nextShadow } from "./shadow";
import { settle } from "@/lib/settle";
import { liveLine } from "@/lib/outcome";

const buy = { kind: "prediction_order", eventTicker: "BTC2611302200", symbol: "GEMI-BTC2611302200-HI70000", label: "$70,000 or above", side: "yes", orderType: "limit", maxPrice: 0.62, quantity: 10 } as Extract<MoveAction, { kind: "prediction_order" }>;
const resting: OrderResult = { venue: "gemini-sandbox", status: "open", detail: "", notional: 6.2, orderId: "123", filledQuantity: 0 };

describe("following a test-exchange order on the live market", () => {
  it("only test-exchange and practice buys are followed", () => {
    expect(followsLive(resting, buy)).toBe(true);
    expect(followsLive({ ...resting, venue: "gemini" }, buy)).toBe(false);
    expect(followsLive(resting, { ...buy, trade: "sell" })).toBe(false);
  });

  it("waits while live sellers ask more, and fills at the live price once they reach the limit", () => {
    expect(nextShadow(resting, buy, 0.66)).toMatchObject({ state: "waiting", liveAsk: 0.66 });
    expect(nextShadow(resting, buy, null)).toMatchObject({ state: "waiting" });
    const f = nextShadow(resting, buy, 0.61, "2026-11-20T15:04:00.000Z");
    expect(f).toEqual({ state: "filled", price: 0.61, at: "2026-11-20T15:04:00.000Z", liveAsk: 0.61 });
    // Once filled it stays filled at that price.
    expect(nextShadow({ ...resting, shadow: f }, buy, 0.4)).toBe(f);
  });

  it("settles from the live result: a real fill first, then what it would have paid", () => {
    const shadowed: OrderResult = { ...resting, shadow: { state: "filled", price: 0.61, at: "x" } };
    expect(settle(buy, shadowed, () => "yes")).toMatchObject({ won: true, paid: 10, cost: 6.1, practice: true });
    // Never reached the price: nothing to settle, it wouldn't have filled.
    expect(settle(buy, { ...resting, shadow: { state: "waiting", liveAsk: 0.7 } }, () => "yes")).toBeUndefined();
    // A real fill on the test exchange counts as itself.
    expect(settle(buy, { ...shadowed, status: "filled", filledQuantity: 4, avgPrice: 0.5 }, () => "yes")).toMatchObject({ quantity: 4, cost: 2, practice: false });
  });

  it("says it in one line", () => {
    expect(liveLine({ ...resting, shadow: { state: "waiting", liveAsk: 0.66 } }, 0.62)).toBe("Live market: cheapest seller at 66¢, waiting for your 62¢");
    expect(liveLine({ ...resting, shadow: { state: "filled", price: 0.61, at: "2026-11-20T15:04:00.000Z" } })).toBe("Live market: would have filled at 61¢ at 15:04 UTC");
  });
});
