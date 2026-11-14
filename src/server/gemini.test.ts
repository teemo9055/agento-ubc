import { describe, expect, it } from "vitest";
import { searchTerms } from "./gemini";

describe("searchTerms", () => {
  it("maps known assets and ignores filler", () => {
    expect(searchTerms("How have BTC odds moved today?")).toEqual(["BTC"]);
    expect(searchTerms("Track ethereum and solana markets")).toEqual(["ETH", "SOL"]);
  });
  it("falls back to plain words", () => {
    expect(searchTerms("What's moving in weather markets?")).toEqual(["weather"]);
  });
});
