import { describe, expect, it } from "vitest";
import type { OrderResult, Run } from "@/lib/types";
import { allLessons, forgetLesson, lessonLines, recordOrder, topicOf } from "./knowledge";

const run = (id: string, maxPrice: number, ask: number): Run =>
  ({
    id,
    agent: "inso",
    finishedAt: "2026-11-15T00:00:00.000Z",
    proposal: {
      id: "p",
      title: "t",
      why: "w",
      ask: "a",
      research: [],
      venue: "gemini-sandbox",
      market: { ask, bid: ask - 0.02 },
      action: { kind: "prediction_order", eventTicker: "BTC2611152200", symbol: "GEMI-BTC2611152200-HI62500", label: "x", side: "yes", orderType: "limit", maxPrice, quantity: 2 },
    },
  }) as unknown as Run;

const order = (status: OrderResult["status"], extra: Partial<OrderResult> = {}): OrderResult => ({ venue: "gemini-sandbox", status, detail: "d", updatedAt: "2026-11-15T00:40:00.000Z", ...extra });

describe("shared knowledge learns from how moves ended", () => {
  it("names market families from tickers", () => {
    expect(topicOf("BTC2611152200")).toBe("BTC");
    expect(topicOf("NBA-2611152100-LAL-PHX-M")).toBe("NBA");
    expect(topicOf("BTC05M2611150045")).toBe("BTC05M");
  });

  it("turns fills and misses into a lesson about how far below the ask orders fill", () => {
    recordOrder(run("a", 0.55, 0.56), order("filled", { filledQuantity: 2 }));
    recordOrder(run("b", 0.5, 0.56), order("cancelled", { filledQuantity: 0 }));
    recordOrder(run("b", 0.5, 0.56), order("cancelled")); // same job twice: counted once
    const line = lessonLines("inso").find((l) => l.startsWith("BTC"));
    expect(line).toMatch(/1 of 2 past orders filled/);
    expect(line).toMatch(/up to 1¢ below the ask/);
    expect(line).toMatch(/6¢\+ below the ask were cancelled/);
  });

  it("ignores simulations and open orders, keeps refusals, and can forget", () => {
    recordOrder(run("c", 0.5, 0.5), { ...order("simulated"), venue: "paper" });
    recordOrder(run("d", 0.5, 0.5), order("open"));
    recordOrder(run("e", 0.5, 0.5), order("rejected", { detail: "x · Insufficient funds" }));
    expect(lessonLines("inso").some((l) => l.includes("Insufficient funds"))).toBe(true);
    const n = allLessons("inso").length;
    expect(n).toBe(3);
    forgetLesson(allLessons("inso")[0].id);
    expect(allLessons("inso")).toHaveLength(n - 1);
  });
});
