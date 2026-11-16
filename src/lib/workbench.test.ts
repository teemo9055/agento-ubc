import { describe, expect, it } from "vitest";
import { blueprintOf, kindOf, outline } from "./shape";
import { quickFor, stepFromText } from "./quick";
import type { ChatMsg, Plan, Proposal, Run } from "./types";

const move = (over: Partial<Proposal> = {}): Proposal => ({
  id: "p1",
  title: "Buy YES on BTC above $65,000",
  why: "It looks likely",
  ask: "Buy 4 YES at 58¢ or less?",
  venue: "paper",
  research: [{ id: "r1", tool: "oracle_price", args: { symbol: "btcusd" }, label: "Chainlink BTC", why: "second source" }],
  action: { kind: "prediction_order", eventTicker: "E", symbol: "S", label: "$65,000 or above", side: "yes", orderType: "limit", maxPrice: 0.58, quantity: 4 },
  ...over,
});
const agent = (over: Partial<ChatMsg>): ChatMsg => ({ id: "m", role: "agent", text: "ok", at: "2026-01-01T00:00:00Z", ...over });
const run = (over: Partial<Run>): Pick<Run, "status" | "chat" | "proposal" | "thinking"> => ({ status: "exploring", chat: [], ...over }) as Run;
const plan = (n: number, tool = "odds_history"): Plan => ({
  id: "pl",
  title: "T",
  why: "",
  unavailable: [],
  status: "proposed",
  steps: Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, agent: "inso" as const, proposal: move({ id: `p${i}`, research: [{ id: "r1", tool, args: {}, label: "L", why: "" }] }), after: [], gate: "done" as const, status: "waiting" as const })),
});

describe("the sketch of the work", () => {
  it("picks the outline from how the request is worded", () => {
    expect(kindOf("What's BTC worth?")).toBe("lookup");
    expect(kindOf("Buy $5 of ETH")).toBe("order");
    expect(kindOf("Buy $5 of ETH if it drops under $3,000")).toBe("conditional");
    expect(kindOf("I'm worried about a heatwave, hedge my power bill")).toBe("hedge");
    expect(kindOf("Plan a drive from Dallas to Austin")).toBe("trip");
    expect(kindOf("Check BTC, sell $5, then bet the proceeds")).toBe("plan");
  });

  it("draws every kind as placeholders until there is a move", () => {
    for (const k of ["lookup", "order", "conditional", "hedge", "trip", "plan"] as const) {
      const bp = outline(k);
      expect(bp.lanes.length).toBeGreaterThanOrEqual(2);
      expect(bp.lanes.at(-1)!.key).toBe("gets");
      expect(bp.lanes.flatMap((l) => l.blocks).every((b) => b.ghost)).toBe(true);
    }
  });

  it("fills the outline from a move: what it reads, checks, does and returns, and the most it costs", () => {
    const bp = blueprintOf(move({ condition: { metric: "oracle_price", symbol: "btcusd", op: ">=", value: 63000 }, also: [{ metric: "spot_price", symbol: "btcusd", op: ">=", value: 63000 }] }));
    expect(bp.kind).toBe("conditional");
    expect(bp.lanes.map((l) => [l.key, l.blocks.map((b) => b.label)])).toEqual([
      ["reads", ["Chainlink BTC"]],
      ["checks", ["Chainlink BTC ≥ $63,000", "BTC price ≥ $63,000"]],
      ["does", ["Buy 4 × YES"]],
      ["gets", ["$4.00 if YES wins"]],
    ]);
    expect(bp.costUsd).toBeCloseTo(0.0001 + 0.58 * 4, 6);
    expect(bp.lanes.flatMap((l) => l.blocks).some((b) => b.ghost)).toBe(false);
  });

  it("draws a hedge as a payout, a trip as days, and a lookup as an answer", () => {
    const hedge = blueprintOf(move({ hedge: { protects: "my BTC", lossUsd: 20, cost: 2.32, payout: 4, covered: 0.2 } }));
    expect(hedge.kind).toBe("hedge");
    expect(hedge.lanes.at(-1)!.blocks[0].label).toBe("$4.00 if it happens");
    const trip = blueprintOf(move({ research: [], action: { kind: "itinerary", stops: ["Dallas", "Austin"], hoursPerDay: 4 } }));
    expect([trip.kind, trip.costUsd]).toEqual(["trip", 0]);
    const look = blueprintOf(move({ action: undefined }));
    expect([look.kind, look.lanes.map((l) => l.key)]).toEqual(["lookup", ["reads", "gets"]]);
    // Selling spends nothing.
    expect(blueprintOf(move({ research: [], action: { kind: "spot_order", symbol: "btcusd", side: "sell", limitPrice: 65000, amountUsd: 5 } })).lanes.at(-1)!.blocks[0].label).toBe("About $5 in cash");
  });
});

describe("quick options above the chat box", () => {
  it("offers nothing while the agent is working or when it asked a question with its own answers", () => {
    expect(quickFor(run({ thinking: "Looking", chat: [agent({ suggestions: ["A"] })] }))).toEqual([]);
    expect(quickFor(run({ chat: [agent({ options: ["Yes", "No"], suggestions: [] })] }))).toEqual([]);
  });

  it("after an answer, leads with the likeliest next step", () => {
    const q = quickFor(run({ chat: [agent({ suggestions: ["Set up an order on it", "Check the odds history first", "Show my positions"] })] }));
    expect(q.map((x) => [x.label, Boolean(x.primary)])).toEqual([
      ["Set up an order on it", true],
      ["Check the odds history first", false],
      ["Show my positions", false],
    ]);
    expect(q[1].adds).toBe(true);
  });

  it("with a move on screen, offers ways to change it and leaves the yes to the card's own button", () => {
    const q = quickFor(run({ chat: [agent({ proposal: move(), suggestions: ["Yes, set it up", "Only if Chainlink agrees ($0.0001)", "Make it 2 contracts", "Check the odds history first ($0.02)", "See who's buying first ($0.10)", "Not now"] })] }));
    expect(q.map((x) => x.label)).toEqual(["Only if Chainlink agrees ($0.0001)", "Make it 2 contracts", "Check the odds history first ($0.02)", "See who's buying first ($0.10)"]);
    expect(q.some((x) => x.primary)).toBe(false);
  });

  it("with a plan on the board, leads with starting it and offers the steps it doesn't have yet", () => {
    const q = quickFor(run({ chat: [agent({ plan: plan(3), suggestions: ["Yes, start the plan", "Make it cheaper", "Not now"] })] }), plan(3));
    expect(q.map((x) => x.label)).toEqual(["Start all 3 steps", "Price check", "Gas check", "Your own step", "Make it cheaper"]);
    expect(q[0]).toMatchObject({ primary: true, do: { act: "start-plan" } });
    expect(q[1].do).toEqual({ add: { agent: "trado", brief: "Read the Chainlink prices of BTC and ETH" } });
    // A plan that already reads Chainlink isn't offered another price check; a full plan isn't offered more steps.
    expect(quickFor(run({ chat: [agent({})] }), plan(3, "oracle_price")).map((x) => x.label)).toEqual(["Start all 3 steps", "Gas check", "Your own step"]);
    expect(quickFor(run({ chat: [agent({})] }), plan(12)).map((x) => x.label)).toEqual(["Start all 12 steps"]);
    // Once it's running the one decision left is to stop it; once it's over there is none.
    expect(quickFor(run({ chat: [agent({})] }), { ...plan(3), status: "running" }).map((x) => x.label)).toEqual(["Stop the plan"]);
    expect(quickFor(run({ chat: [agent({})] }), { ...plan(3), status: "done" })).toEqual([]);
  });

  it("on a draft, keeps the changes that were offered with the move and leaves approving to the review card", () => {
    const p = move();
    const q = quickFor(run({ status: "draft", proposal: p, chat: [agent({ proposal: p, suggestions: ["Yes, set it up", "Make it 2 contracts", "Not now"] })] }));
    expect(q.map((x) => [x.label, Boolean(x.primary)])).toEqual([["Make it 2 contracts", false]]);
  });

  it("reads “Add a step: …” as a step for the board", () => {
    expect(stepFromText("Add a step: check gas on Base")).toBe("check gas on Base");
    expect(stepFromText("add another step - read the euro rate")).toBe("read the euro rate");
    expect(stepFromText("Can you add something?")).toBeNull();
  });
});
