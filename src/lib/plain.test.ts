import { describe, expect, it } from "vitest";
import { askOf, doesLine, getsLine, outcomeOf, plainWords, SHORTHAND, titleOf } from "./plain";
import { risksOf } from "./risks";
import { blueprintOf } from "./shape";
import { adjustmentsFor } from "./adjust";
import type { CostLine, MoveAction, Proposal } from "./types";

const buy: MoveAction = { kind: "prediction_order", eventTicker: "BTC", symbol: "S", label: "$65,000 or above", event: "BTC price on November 30", side: "yes", orderType: "limit", maxPrice: 0.5, quantity: 10 };
const legs = [
  { eventTicker: "A", symbol: "a", label: "$65,000 or above", event: "BTC price on November 30", side: "no" as const, price: 0.47 },
  { eventTicker: "B", symbol: "b", label: "$100 or above", event: "Oil price tomorrow", side: "yes" as const, price: 0.3 },
];
const moves: Record<string, Proposal> = {
  buy: { id: "1", title: "t", why: "w", ask: "a", venue: "paper", research: [{ id: "r1", tool: "oracle_price", args: { symbol: "btcusd" }, label: "Chainlink BTC", why: "a second source" }], action: buy, condition: { metric: "oracle_price", symbol: "btcusd", op: ">=", value: 64000 }, market: { ask: 0.54, bid: 0.5 } },
  no: { id: "2", title: "t", why: "w", ask: "a", venue: "gemini-sandbox", research: [], action: { ...buy, side: "no" } },
  cover: { id: "3", title: "t", why: "w", ask: "a", venue: "paper", research: [], action: buy, hedge: { protects: "fuel going up", lossUsd: 20, cost: 5, payout: 10, covered: 5 } },
  both: { id: "4", title: "t", why: "w", ask: "a", venue: "paper", research: [], action: { ...buy, symbol: "COMBO", label: "x", combo: { legs, fair: 0.14 } } },
  sell: { id: "5", title: "t", why: "w", ask: "a", venue: "gemini-sandbox", research: [], action: { ...buy, trade: "sell" } },
  coin: { id: "6", title: "t", why: "w", ask: "a", venue: "paper", research: [], action: { kind: "spot_order", symbol: "ethusd", side: "buy", limitPrice: 1800, amountUsd: 10 } },
  trip: { id: "7", title: "t", why: "w", ask: "a", venue: "paper", research: [], action: { kind: "itinerary", stops: ["Dallas", "Austin"], hoursPerDay: 6 } },
};
const line = (id: string): CostLine => ({ id, phaseId: id, purpose: "Chainlink BTC", service: "s", payeeName: "Quicknode", payee: "0x0000000000000000000000000000000000000001", rail: "gateway", approved: "100", actual: "0", index: 0, bigSpend: false }) as CostLine;

describe("everything a move says to a person is in everyday words", () => {
  it("names the outcome the way you'd say it", () => {
    expect(outcomeOf({ label: "$65,000 or above", side: "no" })).toBe("Below $65,000");
    expect(outcomeOf({ label: "$1.50 or below", side: "no" })).toBe("Above $1.50");
    expect(outcomeOf({ label: "Lakers", side: "no" })).toBe("Not “Lakers”");
    expect(doesLine(buy)).toEqual({ label: "Pay up to $5", detail: "50¢ or less for each $1 it can pay" });
    expect(getsLine(moves.buy)).toEqual({ label: "$10 if it's “$65,000 or above”", detail: "the market puts that at about 1 in 2; nothing if it goes the other way" });
  });

  it("uses no market shorthand in titles, questions, the drawing, quick changes or risks", () => {
    for (const [name, p] of Object.entries(moves)) {
      const said = [
        titleOf(p),
        askOf(p),
        ...blueprintOf({ ...p, title: titleOf(p), ask: askOf(p) }).lanes.flatMap((l) => l.blocks.flatMap((b) => [b.label, b.detail ?? ""])),
        ...adjustmentsFor(p).map((a) => a.label),
        ...risksOf({ proposal: p, lines: p.research.map((r) => line(r.id)) }).flatMap((r) => [r.if, r.then]),
      ];
      for (const s of said) {
        expect(s, `${name}: “${s}”`).not.toMatch(SHORTHAND);
        expect(s, `${name}: “${s}”`).not.toMatch(/\b(YES|NO)\b|×|≤|≥|contracts?\b/);
      }
    }
  });

  it("puts the agent's own shorthand into plain words", () => {
    expect(plainWords("Bundling both downside legs into one combo keeps the hedge cheap.")).toBe("Bundling both drop parts into one combined cover keeps the cover cheap.");
    expect(plainWords("Hedging with a resting limit order avoids slippage.")).toBe("Covering with a waiting order avoids price drift.");
    expect(plainWords("BTC is at $64,000.")).toBe("BTC is at $64,000.");
  });
});

describe("what can go wrong is read from how the job is built", () => {
  const ifs = (p: Proposal) => risksOf({ proposal: p, lines: p.research.map((r) => line(r.id)) }).map((r) => r.if);
  it("a checked practice order with paid data: seller, check, practice, losing, leftovers", () => {
    expect(ifs(moves.buy)).toEqual(["The data seller doesn't answer, or asks for more", "A seller sends an empty or wrong answer", "The check doesn't pass", "No exchange is connected", "It goes the other way", "Something is left over"]);
    const check = risksOf({ proposal: moves.buy, lines: [line("r1")] })[2];
    expect(check.then).toBe("Nothing is bought. The lookups already paid for ($0.0001) stay paid.");
  });

  it("a real order waits and can be cancelled; cover and combined cover say what losing means", () => {
    expect(ifs(moves.no)).toEqual(["Nobody sells at your price", "It goes the other way"]);
    expect(ifs(moves.sell)).toEqual(["Nobody buys at your price"]);
    expect(ifs(moves.cover)).toContain("The thing you're covering doesn't happen");
    expect(ifs(moves.both)).toContain("Any one of them doesn't happen");
    expect(risksOf({ proposal: moves.no, lines: [] })[1].then).toContain("at most $5.00");
  });

  it("a trip risks nothing but time", () => {
    expect(ifs(moves.trip)).toEqual(["Traffic or stops take longer"]);
  });
});
