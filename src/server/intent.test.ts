import { describe, expect, it } from "vitest";
import { intentOf } from "./explore";

describe("rule-based replies read plain words", () => {
  it("amounts, sizes and price limits", () => {
    expect(intentOf("put $20 on BTC")).toMatchObject({ budgetUsd: 20 });
    expect(intentOf("buy 10 contracts under 40¢")).toMatchObject({ quantity: 10, maxPrice: 0.4 });
    expect(intentOf("spend 15 dollars")).toMatchObject({ budgetUsd: 15 });
  });
  it("selling, positions and the NO side only when asked", () => {
    expect(intentOf("sell my calmest position")).toMatchObject({ sell: true, positions: true });
    expect(intentOf("I think BTC won't reach 70k")).toMatchObject({ no: true });
    expect(intentOf("What are BTC odds right now?")).toMatchObject({ no: false, sell: false, positions: false });
    expect(intentOf("will BTC fall below 60k")).toMatchObject({ no: false });
  });
});
