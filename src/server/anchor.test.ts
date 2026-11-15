import { describe, expect, it } from "vitest";
import { orderDigest, orderRecord } from "./anchor";

describe("order fingerprints", () => {
  const o = { venue: "gemini-sandbox" as const, status: "open" as const, detail: "5 × YES “Up” at ≤ 52¢", orderId: "145853902319280100", symbol: "GEMI-BTC-1", quantity: 5 };
  it("anyone with the receipt can recompute the hash", () => {
    const run = { id: "job1", planHash: "0xabc" as const };
    expect(orderDigest(run, o)).toBe(orderDigest(run, { ...o, filledQuantity: 3, status: "filled" }));
    expect(orderRecord(run, o)).toEqual({ job: "job1", plan: "0xabc", venue: "gemini-sandbox", orderId: "145853902319280100", detail: o.detail, symbol: "GEMI-BTC-1", quantity: 5 });
  });
  it("a changed order gives a different hash", () => {
    const run = { id: "job1" };
    expect(orderDigest(run, o)).not.toBe(orderDigest(run, { ...o, quantity: 50 }));
  });
});
