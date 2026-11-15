import { describe, expect, it } from "vitest";
import { knownNumbers, unsupported } from "./grounding";

const data = [{ markets: [{ title: "BTC price today", contracts: [{ label: "$64,500 or above", last: 0.49, bid: 0.48, ask: 0.5 }] }] }, { symbol: "btcusd", last: 64284.89, change24h: -0.0459 }];

describe("numbers in replies must come from the data", () => {
  const known = knownNumbers(data);
  it("accepts prices, cents, percentages and rounding that match", () => {
    expect(unsupported("BTC is at $64,285, down 4.6%. The $64,500 contract trades at 49¢ (49%), NO at 51¢.", known)).toEqual([]);
    expect(unsupported("BTC near $64.3k", known)).toEqual([]);
  });
  it("flags numbers that appear nowhere", () => {
    expect(unsupported("BTC is at $71,000 and the contract is 83¢", known).map((c) => c.text)).toEqual(["$71,000", "83¢"]);
  });
});
