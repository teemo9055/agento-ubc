import { describe, expect, it } from "vitest";
import { guide } from "./explore";
import { routeByRules } from "./route";

describe("requests find their agent", () => {
  it("routes clear asks by what they need", () => {
    expect(routeByRules("I want to protect myself against a cost")).toBe("inso");
    expect(routeByRules("What are the odds BTC ends above 65k?")).toBe("inso");
    expect(routeByRules("Buy $10 of ETH on a dip")).toBe("trado");
    expect(routeByRules("Plan a drive from Calgary to Banff")).toBe("travo");
    expect(routeByRules("Sell my calmest position, then plan a drive from Dallas to Austin")).toBe("inso");
    expect(routeByRules("hello there")).toBeNull();
  });
});

describe("a goal without a subject gets one question", () => {
  it("asks what to protect, what to bet on, where to drive, which coin", () => {
    expect(guide("inso", "I want to protect myself against a cost")?.question).toMatch(/cost you money/);
    expect(guide("inso", "I want to bet on something")?.options.length).toBeGreaterThanOrEqual(2);
    expect(guide("travo", "Plan a road trip for me")?.question).toMatch(/start and end/);
    expect(guide("trado", "I want to trade a coin")?.options).toContain("BTC");
  });
  it("doesn't ask when the request already says it", () => {
    expect(guide("inso", "Hedge my BTC for $30")).toBeNull();
    expect(guide("inso", "What are BTC odds right now?")).toBeNull();
    expect(guide("travo", "Drive from Vancouver to Seattle")).toBeNull();
    expect(guide("trado", "Is BTC trending this week?")).toBeNull();
  });
});
