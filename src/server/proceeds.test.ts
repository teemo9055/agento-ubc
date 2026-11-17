import { beforeAll, describe, expect, it, vi } from "vitest";
import type { MoveAction, OrderResult } from "@/lib/types";

/**
 * "Sell X, then spend what it brought in on Y", against a stand-in for Gemini's test exchange:
 * a real held position, a sell that fills at once, one that rests and fills later, and one that
 * is closed after selling only part.
 */
process.env.DEMO_DELAY_SCALE = "0";
process.env.AI_DISABLED = "true";
// Watch a resting order for a few milliseconds instead of five minutes.
process.env.WATCH_MINUTES = "0.0005";
process.env.WATCH_POLL_MS = "5";

const ex = vi.hoisted(() => ({ sell: { status: "filled" as "filled" | "open" | "cancelled", filled: 10, avg: 0.58 } }));

vi.mock("@/server/agents/ai-planning", async (orig) => ({ ...(await orig<typeof import("@/server/agents/ai-planning")>()), spotSymbols: async () => ["btcusd"] }));
vi.mock("@/server/nanopay", async (orig) => ({ ...(await orig<typeof import("@/server/nanopay")>()), ensureGatewayFunds: async () => {} }));
vi.mock("@/server/gemini", async (orig) => ({
  ...(await orig<typeof import("@/server/gemini")>()),
  getEvent: async () => ({
    ticker: "BTC-1",
    title: "BTC today",
    category: "Crypto",
    volume: 10,
    contracts: [
      { symbol: "GEMI-BTC-A", label: "A", last: 0.59, bid: 0.58, ask: 0.6, open: true },
      { symbol: "GEMI-BTC-B", label: "B", last: 0.5, bid: 0.49, ask: 0.52, open: true },
    ],
  }),
}));
vi.mock("@/server/exchange", async (orig) => {
  const real = await orig<typeof import("@/server/exchange")>();
  const venue = "gemini-sandbox" as const;
  const sold = (o: Partial<OrderResult>): OrderResult => ({ venue, detail: "Sell 10 × YES “A” at ≥ 58¢", orderId: "900", notional: 0, symbol: "GEMI-BTC-A", quantity: 10, ...o, status: ex.sell.status, filledQuantity: ex.sell.filled, avgPrice: ex.sell.avg });
  return {
    ...real,
    tradingVenue: () => venue,
    spotFeeBps: async () => ({ maker: 0, taker: 0 }),
    positions: async () => ({ venue, positions: [{ symbol: "GEMI-BTC-A", eventTicker: "BTC-1", label: "A", event: "BTC today", outcome: "yes", quantity: 10, available: 10, avgPrice: 0.4, sellPrice: 0.58, marketValue: 5.8, unrealizedPnl: 1.8 }] }),
    placeOrder: async (a: MoveAction): Promise<OrderResult> => {
      if (a.kind === "prediction_order" && a.trade === "sell") return sold({});
      const p = a as Extract<MoveAction, { kind: "prediction_order" }>;
      return { venue, status: "filled", detail: real.describeAction(a), orderId: "901", notional: p.maxPrice * p.quantity, symbol: p.symbol, quantity: p.quantity, filledQuantity: p.quantity, avgPrice: p.maxPrice };
    },
    refreshOrder: async (o: OrderResult) => (o.orderId === "900" ? sold(o) : o),
    cancelOrder: async (o: OrderResult) => ({ ...o, status: "cancelled" as const }),
  };
});

let orch: typeof import("@/server/orchestrator");
let tools: typeof import("@/server/tools");
beforeAll(async () => {
  orch = await import("@/server/orchestrator");
  tools = await import("@/server/tools");
});

const tick = () => new Promise((r) => setTimeout(r, 5));
async function until(fn: () => boolean, what: string) {
  for (let i = 0; i < 800; i++) {
    if (fn()) return;
    await tick();
  }
  throw new Error(`timed out waiting for ${what}`);
}

const sell = { title: "Sell A", why: "take the profit", ask: "Sell 10 YES at 58¢ or more?", research: [], action: { kind: "prediction_order", eventTicker: "BTC-1", symbol: "GEMI-BTC-A", label: "A", side: "yes", trade: "sell", orderType: "limit", maxPrice: 0.58, stopPrice: null, quantity: 10 }, condition: null, budgetUsd: null };
const buy = { title: "Buy B", why: "next idea", ask: "Buy YES on B?", research: [], action: { kind: "prediction_order", eventTicker: "BTC-1", symbol: "GEMI-BTC-B", label: "B", side: "yes", orderType: "limit", maxPrice: 0.52, stopPrice: null, quantity: 40 }, condition: null, budgetUsd: null };

async function start() {
  const v = await tools.validatePlan(
    {
      title: "Sell A, then buy B with it",
      why: "Roll the money over",
      unavailable: [],
      steps: [
        { agent: "inso", brief: "Sell my 10 YES of A", after: [], gate: "done", useProceeds: false },
        { agent: "inso", brief: "Buy YES on B with the money", after: [1], gate: "filled", useProceeds: true },
      ],
    },
    `p${Math.random().toString(36).slice(2, 8)}`,
    (agent, brief, id) => tools.validateProposal(agent, brief.startsWith("Sell") ? sell : buy, id),
  );
  if ("error" in v) throw new Error(v.error);
  const r = await orch.createRun({ agent: "inso", task: "Sell A then buy B with the money" }, { quiet: true });
  orch.offerPlan(r.id, v.plan!);
  await orch.startPlan(r.id, v.plan!.id);
  return r.id;
}
const stepsOf = (id: string) => orch.getRun(id)!.plan!.steps;
const bought = (id: string) => orch.getRun(stepsOf(id)[1].runId!)!;

describe("spending what a sell on the exchange brought in", () => {
  it("a sell that fills at once funds the next step with exactly its proceeds", async () => {
    ex.sell = { status: "filled", filled: 10, avg: 0.58 };
    const id = await start();
    await until(() => orch.getRun(id)!.plan?.status === "done", "the plan to finish");
    expect(stepsOf(id).map((s) => s.status)).toEqual(["done", "done"]);
    // 10 sold at 58¢ = $5.80, which buys 11 contracts at 52¢ (not the 40 first drafted).
    expect(bought(id).proposal).toMatchObject({ budgetUsd: 5.8, action: { quantity: 11 } });
    expect(bought(id).order).toMatchObject({ status: "filled", quantity: 11 });
    expect(bought(id).handoff).toMatch(/Budget for this step: \$5\.80/);
  });

  it("a sell that rests on the book holds the next step until it fills", async () => {
    ex.sell = { status: "open", filled: 4, avg: 0.58 };
    const id = await start();
    await until(() => stepsOf(id)[1].status === "blocked", "step 2 to wait for the fill");
    expect(stepsOf(id)[1]).toMatchObject({ runId: undefined, note: "Waiting for step 1's order to fill" });
    // Nothing was bought while the sell was only part filled.
    expect(orch.getRun(id)!.plan!.status).toBe("running");

    ex.sell = { status: "filled", filled: 10, avg: 0.59 };
    await orch.refreshRunOrder(stepsOf(id)[0].runId!); // what the background tracker does every minute
    await until(() => orch.getRun(id)!.plan?.status === "done", "the plan to finish");
    // Filled at 59¢ in the end: $5.90 buys 11 at 52¢.
    expect(bought(id).proposal).toMatchObject({ budgetUsd: 5.9, action: { quantity: 11 } });
  });

  it("a sell closed after selling only part funds the next step with that part", async () => {
    ex.sell = { status: "open", filled: 4, avg: 0.58 };
    const id = await start();
    await until(() => stepsOf(id)[1].status === "blocked", "step 2 to wait for the fill");
    ex.sell = { status: "cancelled", filled: 4, avg: 0.58 };
    await orch.cancelRunOrder(stepsOf(id)[0].runId!);
    await until(() => orch.getRun(id)!.plan?.status === "done", "the plan to finish");
    // 4 sold at 58¢ = $2.32, which buys 4 at 52¢.
    expect(bought(id).proposal).toMatchObject({ budgetUsd: 2.32, action: { quantity: 4 } });
  });

  it("a sell cancelled before anything sold stops the step that needed its money", async () => {
    ex.sell = { status: "open", filled: 0, avg: 0.58 };
    const id = await start();
    await until(() => stepsOf(id)[1].status === "blocked", "step 2 to wait for the fill");
    ex.sell = { status: "cancelled", filled: 0, avg: 0.58 };
    await orch.cancelRunOrder(stepsOf(id)[0].runId!);
    await until(() => orch.getRun(id)!.plan?.status === "done", "the plan to settle");
    expect(stepsOf(id)[1]).toMatchObject({ status: "skipped", runId: undefined });
    expect(stepsOf(id)[1].note).toMatch(/Step 1's order was cancelled/);
  });
});
