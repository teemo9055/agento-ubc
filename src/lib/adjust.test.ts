import { describe, expect, it } from "vitest";
import { adjustmentsFor, applyAdjust, sizeOf, type Adjustable } from "./adjust";
import { askOf, chance, titleOf } from "./plain";
import { quickFor } from "./quick";
import type { ChatMsg, MoveAction, Proposal, Run } from "./types";

const buy: MoveAction = { kind: "prediction_order", eventTicker: "BTC", symbol: "S", label: "$65,000 or above", event: "BTC price on November 30", side: "yes", orderType: "limit", maxPrice: 0.5, quantity: 10 };
const move = (over: Partial<Proposal> = {}): Proposal => ({ id: "p1", title: "Buy 10 YES", why: "w", ask: "Buy 10 YES at 50¢?", venue: "paper", research: [], action: buy, market: { ask: 0.54, bid: 0.5 }, ...over });
const input = (p: Proposal): Adjustable => ({ research: [...p.research], action: p.action ? { ...p.action } : null, condition: p.condition ?? null, alsoRequire: p.also ?? null, budgetUsd: p.budgetUsd ?? null, hedge: p.hedge ? { protects: p.hedge.protects, lossUsd: p.hedge.lossUsd } : null });
const labels = (p: Proposal) => adjustmentsFor(p).map((a) => a.label);

describe("quick changes say what they lead to", () => {
  it("an order: more and fewer with the new total, and the price that would buy now", () => {
    expect(labels(move())).toEqual(["Buy 5 more (total $7.50)", "Spend less: 5 fewer ($2.50)", "Buy now at 54¢"]);
    // Already at or over the cheapest seller: the other direction is offered.
    expect(labels(move({ market: { ask: 0.5, bid: 0.48 } }))).toContain("Wait for a lower price (48¢)");
    // One contract can't get smaller.
    expect(labels(move({ action: { ...buy, quantity: 1 } })).some((l) => /fewer/.test(l))).toBe(false);
  });

  it("cover is changed by how much it protects, not by contracts", () => {
    const p = move({ hedge: { protects: "fuel", lossUsd: 20, cost: 5, payout: 26, covered: 20 } });
    expect(sizeOf(p)).toMatchObject({ now: 20, up: 30, down: 10, unit: "cover" });
    expect(labels(p).slice(0, 2)).toEqual(["Cover $30 instead", "Cover only $10"]);
    expect(applyAdjust(input(p), p, "more").hedge).toEqual({ protects: "fuel", lossUsd: 30 });
  });

  it("coins change by dollars, trips by hours a day", () => {
    const spot = move({ action: { kind: "spot_order", symbol: "ethusd", side: "buy", limitPrice: 1800, amountUsd: 10 } });
    expect(labels(spot)).toEqual(["Buy $15 instead", "Spend less: only $5"]);
    const trip = move({ action: { kind: "itinerary", stops: ["Dallas", "Austin"], hoursPerDay: 6 } });
    expect(labels(trip)).toEqual(["Longer days (8 h)", "Shorter days (4 h)"]);
    expect(applyAdjust(input(trip), trip, "less").action).toMatchObject({ hoursPerDay: 4 });
  });

  it("offers dropping paid lookups and the check only when the move has them", () => {
    const p = move({ research: [{ id: "r1", tool: "oracle_price", args: { symbol: "btcusd" }, label: "Chainlink BTC", why: "" }], condition: { metric: "oracle_price", symbol: "btcusd", op: ">=", value: 64000 } });
    expect(labels(p)).toEqual(expect.arrayContaining(["Skip the paid lookup (save $0.0001)", "Go ahead without the check"]));
    // Without the lookup the Chainlink check has nothing to read, so it goes too.
    expect(applyAdjust(input(p), p, "drop-lookups")).toMatchObject({ research: [], condition: null });
    expect(labels(move()).some((l) => /Skip the paid lookup/.test(l))).toBe(false);
  });
});

describe("applying a quick change", () => {
  it("moves the size one step and lifts an earlier budget when asked for more", () => {
    const p = move({ budgetUsd: 5 });
    expect(applyAdjust(input(p), p, "more")).toMatchObject({ action: { quantity: 15 }, budgetUsd: null });
    expect(applyAdjust(input(p), p, "less")).toMatchObject({ action: { quantity: 5 }, budgetUsd: 5 });
    expect(() => applyAdjust(input(move({ action: { ...buy, quantity: 1 } })), move({ action: { ...buy, quantity: 1 } }), "less")).toThrow(/smaller/);
  });

  it("sets the price to what buys now, or two cents either way", () => {
    expect(applyAdjust(input(move()), move(), "pay-more").action).toMatchObject({ maxPrice: 0.54 });
    expect(applyAdjust(input(move()), move(), "pay-less").action).toMatchObject({ maxPrice: 0.48 });
    const sell = move({ action: { ...buy, trade: "sell", maxPrice: 0.55 } });
    expect(applyAdjust(input(sell), sell, "pay-less").action).toMatchObject({ maxPrice: 0.5 });
  });
});

describe("the options above the chat box perfect the move or move it forward", () => {
  const agent = (over: Partial<ChatMsg>): ChatMsg => ({ id: "m", role: "agent", text: "ok", at: "2026-01-01T00:00:00Z", ...over });
  it("while shaping: review first, then instant changes, then one thing only the agent can add", () => {
    const p = move();
    const q = quickFor({ status: "exploring", chat: [agent({ proposal: p, suggestions: ["Yes, set it up", "Make it 5 contracts", "Only if Chainlink agrees ($0.0001)", "Not now"] })] } as Run);
    expect(q.map((x) => x.label)).toEqual(["Review and approve", "Buy 5 more (total $7.50)", "Spend less: 5 fewer ($2.50)", "Only if Chainlink agrees ($0.0001)"]);
    expect(q[0]).toMatchObject({ primary: true, do: { act: "review" } });
    expect(q[1].do).toEqual({ adjust: "more" });
    // The agent's own "Make it 5 contracts" is dropped: the instant change covers it.
    expect(q.some((x) => /Make it/.test(x.label))).toBe(false);
  });

  it("while reviewing: the same changes, and no second approve button", () => {
    const p = move();
    const q = quickFor({ status: "draft", proposal: p, chat: [agent({ proposal: p, suggestions: ["Yes, set it up"] })] } as Run);
    expect(q.map((x) => x.label)).toEqual(["Buy 5 more (total $7.50)", "Spend less: 5 fewer ($2.50)", "Buy now at 54¢"]);
    expect(q.every((x) => !x.primary)).toBe(true);
  });
});

describe("plain words for a move", () => {
  it("says what you pay, what you get and when", () => {
    expect(askOf(move())).toBe("Pay up to $5 to get $10 if “$65,000 or above” happens (BTC price on November 30)?");
    expect(askOf(move({ action: { ...buy, side: "no" } }))).toContain("doesn't happen");
    expect(titleOf(move())).toBe("BTC price on November 30: $65,000 or above");
    expect(titleOf(move({ action: { ...buy, side: "no" } }))).toBe("BTC price on November 30: Below $65,000");
    expect(titleOf(move({ hedge: { protects: "fuel going up", lossUsd: 20, cost: 5, payout: 10, covered: 5 } }))).toBe("Cover: fuel going up");
  });

  it("turns a price into a chance people can picture", () => {
    expect(chance(0.5)).toBe("about 1 in 2");
    expect(chance(0.13)).toBe("about 1 in 8");
    expect(chance(0.97)).toBe("very likely");
  });
});

describe("suggestions follow the conversation", () => {
  const msg = (role: "user" | "agent", text: string) => ({ id: text, role, text, at: "" }) as never;
  it("drops a coin nobody mentioned, keeps one that was", async () => {
    const { onTopic } = await import("./quick");
    const chat = [msg("user", "I run a coffee cart and my milk costs keep jumping"), msg("agent", "Milk isn't listed, but I can watch dairy prices.")];
    expect(onTopic("Bet $5 on BTC", chat)).toBe(false);
    expect(onTopic("Find a cheaper supplier", chat)).toBe(true);
    expect(onTopic("Cover me if Bitcoin drops", [msg("user", "I hold BTC")])).toBe(true);
  });
});
