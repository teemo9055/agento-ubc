import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/gemini", async (orig) => {
  const real = await orig<typeof import("@/server/gemini")>();
  const series = Array.from({ length: 20 }, (_, i) => ({ t: i * 60_000, p: 0.4 + i * 0.01 }));
  const found = async (q: string) => [
      { ticker: `${q}-1`, title: `${q} event A`, category: "Crypto", volume: 10, contracts: [{ symbol: `GEMI-${q}-A`, label: "A", last: 0.5, bid: 0.49, ask: 0.51 }] },
      { ticker: `${q}-2`, title: `${q} event B`, category: "Crypto", volume: 9, contracts: [{ symbol: `GEMI-${q}-B`, label: "B", last: 0.3, bid: 0.29, ask: 0.31 }] },
      { ticker: `${q}-3`, title: `${q} event C`, category: "Crypto", volume: 8, contracts: [{ symbol: `GEMI-${q}-C`, label: "C", last: 0.7, bid: 0.69, ask: 0.71 }] },
  ];
  return {
    ...real,
    searchEvents: found,
    findEvents: found,
    getEvent: async (t: string) => {
      const q = t.split("-")[0];
      return { ticker: t, title: `${q} event A`, category: "Crypto", volume: 10, contracts: [{ symbol: `GEMI-${q}-A`, label: "A", last: 0.5, bid: 0.49, ask: 0.51 }] };
    },
    spotTicker: async (symbol: string) => ({ symbol, last: 60000, bid: 59990, ask: 60010, change24h: 0.01, high24h: 61000, low24h: 59000 }),
    oddsHistory: async () => series,
    spotCandles: async () => series.map((s) => ({ ...s, p: 60000 + s.p * 1000 })),
    recentTrades: async () => [
      { t: 1, p: 0.5, size: 10, side: "buy" },
      { t: 2, p: 0.5, size: 4, side: "sell" },
    ],
  };
});

vi.mock("@/server/agents/ai-planning", async (orig) => ({ ...(await orig<typeof import("@/server/agents/ai-planning")>()), spotSymbols: async () => ["btcusd", "ethusd"] }));

vi.mock("@/server/chainlink", async (orig) => ({
  ...(await orig<typeof import("@/server/chainlink")>()),
  chainlinkPrice: async (symbol: string) => ({ symbol, feed: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c", description: "BTC / USD", price: 61000, updatedAt: new Date().toISOString(), ageMinutes: 3, round: "1", paid: { amountUsdc: 0.0001, payTo: "0xF46394adDdA95A3d5bCC1124605E3d15D204623C", via: "test" } }),
}));
vi.mock("@/server/nanopay", async (orig) => ({ ...(await orig<typeof import("@/server/nanopay")>()), gatewayBalance: async () => 1, depositToGateway: async () => ({}), ensureGatewayFunds: async () => {} }));

vi.mock("@/server/geo", () => ({
  geocode: async (q: string) => ({ name: q, lat: 49 - q.length / 10, lon: -123 + q.length / 10 }),
  drive: async (stops: { name: string }[]) => ({
    distanceKm: 230 * (stops.length - 1),
    hours: 2.5 * (stops.length - 1),
    path: stops.map((_, i) => [-123 + i, 49 - i] as [number, number]),
    legs: stops.slice(1).map(() => ({ distanceKm: 230, hours: 2.5 })),
  }),
}));

process.env.DEMO_DELAY_SCALE = "0";
process.env.AI_DISABLED = "true";
process.env.FAULT_TIMEOUT_MS = "50";

let orch: typeof import("@/server/orchestrator");
let explore: typeof import("@/server/explore");
let tools: typeof import("@/server/tools");
beforeAll(async () => {
  orch = await import("@/server/orchestrator");
  explore = await import("@/server/explore");
  tools = await import("@/server/tools");
});

const tick = () => new Promise((r) => setTimeout(r, 5));
const ASK = "What are BTC odds right now, then plan a drive from Vancouver to Seattle, and book a hotel in Seattle";

async function until(fn: () => boolean, what: string) {
  for (let i = 0; i < 600; i++) {
    if (fn()) return;
    await tick();
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe("splitting a request into parts", () => {
  it("finds the parts and who does each", () => {
    const parts = explore.partsOf(ASK);
    expect(parts).toHaveLength(3);
    expect(parts.map(explore.agentFor)).toEqual(["inso", "travo", null]);
    expect(explore.partsOf("What are BTC odds right now?")).toHaveLength(1);
  });
});

describe("plans across agents", () => {
  it("proposes one plan card: a move per agent, and says what it can't do", async () => {
    const r = await orch.createRun({ agent: "inso", task: ASK });
    const plan = r.chat!.find((m) => m.plan)?.plan;
    expect(plan?.steps.map((s) => [s.agent, s.proposal.action?.kind])).toEqual([
      ["inso", "prediction_order"],
      ["travo", "itinerary"],
    ]);
    expect(plan?.unavailable[0].why).toMatch(/Arc mainnet only/);
    expect(r.lines).toHaveLength(0); // nothing priced or paid yet
  });

  it("starting it runs each step as its own job, one after another", async () => {
    const r = await orch.createRun({ agent: "inso", task: ASK });
    const plan = r.chat!.find((m) => m.plan)!.plan!;
    await orch.startPlan(r.id, plan.id);
    await until(() => orch.getRun(r.id)!.plan?.status === "done", "the plan to finish");
    const done = orch.getRun(r.id)!;
    expect(done.plan!.steps.map((s) => s.status)).toEqual(["done", "done"]);
    const kids = done.plan!.steps.map((s) => orch.getRun(s.runId!)!);
    expect(kids.map((k) => [k.agent, k.status, k.parentId, k.stepId])).toEqual([
      ["inso", "done", r.id, "s1"],
      ["travo", "done", r.id, "s2"],
    ]);
    // Step 2 started only after step 1 finished.
    expect(Date.parse(kids[1].createdAt)).toBeGreaterThanOrEqual(Date.parse(kids[0].finishedAt!));
    expect(done.chat!.at(-1)!.text).toMatch(/All 2 steps are done/);
  });

  it("a typed yes starts the plan just shown", async () => {
    const r = await orch.createRun({ agent: "inso", task: ASK });
    await orch.sendChat(r.id, "yes");
    expect(orch.getRun(r.id)!.plan?.status).toBe("running");
    await until(() => orch.getRun(r.id)!.plan?.status === "done", "the plan to finish");
  });

  it("stop cancels the running step and skips the rest", async () => {
    process.env.DEMO_DELAY_SCALE = "1";
    const r = await orch.createRun({ agent: "inso", task: ASK });
    await orch.startPlan(r.id, r.chat!.find((m) => m.plan)!.plan!.id);
    await until(() => orch.getRun(r.id)!.plan?.steps[0].status === "running", "step 1 to start");
    await orch.stopPlan(r.id);
    process.env.DEMO_DELAY_SCALE = "0";
    const after = orch.getRun(r.id)!;
    expect(after.plan!.status).toBe("stopped");
    expect(after.plan!.steps[1]).toMatchObject({ status: "skipped", note: "Plan stopped" });
    await until(() => orch.getRun(after.plan!.steps[0].runId!)!.status === "cancelled", "step 1 to cancel");
  });

  it("plans are checked step by step", async () => {
    const step = (agent: string, gate: string, move: unknown) => ({ agent, gate, move });
    const itinerary = { title: "Drive", why: "trip", ask: "Plan it?", research: [{ tool: "drive_route", args: { stops: "Vancouver|Seattle" }, label: "Route", why: "hours" }], action: { kind: "itinerary", stops: ["Vancouver", "Seattle"], hoursPerDay: 6 }, condition: null, budgetUsd: null };
    const first = await tools.validatePlan({ title: "x", why: "y", unavailable: [], steps: [step("travo", "filled", itinerary), step("travo", "done", itinerary)] }, "p1");
    expect("error" in first && first.error).toMatch(/Step 1 has nothing before it/);
    const afterTrip = await tools.validatePlan({ title: "x", why: "y", unavailable: [], steps: [step("travo", "done", itinerary), step("travo", "filled", itinerary)] }, "p2");
    expect("error" in afterTrip && afterTrip.error).toMatch(/places no order/);
    const wrongAgent = await tools.validatePlan({ title: "x", why: "y", unavailable: [], steps: [step("inso", "done", itinerary), step("travo", "done", itinerary)] }, "p3");
    expect("error" in wrongAgent && wrongAgent.error).toMatch(/Step 1 \(inso\): This agent can't do itinerary/);
  });
});
