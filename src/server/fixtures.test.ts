import { describe, expect, it } from "vitest";
import { shiftTimes } from "./fixtures";

describe("recorded market data", () => {
  const at = Date.parse("2026-11-15T07:00:00Z");
  const now = at + 3 * 86_400_000;
  it("moves dates forward so recorded contracts stay open", () => {
    const body = JSON.stringify({ expiry: "2026-11-30T22:00:00.000Z", t: at - 60_000, timestamp: Math.round(at / 1000), price: "65000", ticker: "BTC2611302200" });
    const out = JSON.parse(shiftTimes(body, at, now));
    expect(out.expiry).toBe("2026-12-03T22:00:00.000Z");
    expect(out.t).toBe(now - 60_000);
    expect(out.timestamp).toBe(Math.round(now / 1000));
    expect(out.price).toBe("65000");
    expect(out.ticker).toBe("BTC2611302200");
  });
  it("leaves far-off numbers alone", () => {
    expect(shiftTimes('{"tid":1893456013456642,"v":1999999999999}', at, now)).toBe('{"tid":1893456013456642,"v":1999999999999}');
  });
});
