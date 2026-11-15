import { describe, expect, it } from "vitest";
import { intentOf, tighten } from "./explore";

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

describe("replies stay short", () => {
  it("drops pointers at the card and where the order goes", () => {
    expect(tighten("The closest to a coin toss is Nov 20 at $65,000. This goes to Simulation.\n\nCheck the details on the card below to approve it.", true)).toBe("The closest to a coin toss is Nov 20 at $65,000.");
  });
  it("keeps decimals and caps plain answers at four sentences", () => {
    expect(tighten("BTC is at $62,613.28. One. Two. Three. Four.", false)).toBe("BTC is at $62,613.28. One. Two. Three.");
  });
});
