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

const hold = vi.hoisted(() => ({ wait: Promise.resolve() as Promise<void>, release: () => {} }));
const pause = () => {
  hold.wait = new Promise<void>((r) => (hold.release = r));
};
vi.mock("@/server/geo", () => ({
  geocode: async (q: string) => ({ name: q, lat: 49 - q.length / 10, lon: -123 + q.length / 10 }),
  nearby: async () => [],
  drive: async (stops: { name: string }[]) => (await hold.wait, {
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

  const move = {
    order: (qty = 5) => ({ title: "Buy YES: BTC A", why: "coin flip", ask: "Buy YES?", research: [], action: { kind: "prediction_order", eventTicker: "BTC-1", symbol: "GEMI-BTC-A", label: "A", side: "yes", orderType: "limit", maxPrice: 0.52, stopPrice: null, quantity: qty }, condition: null, budgetUsd: null }),
    sellCoin: () => ({ title: "Sell $10 of BTC", why: "raise cash", ask: "Sell $10 of BTC?", research: [], action: { kind: "spot_order", symbol: "btcusd", side: "sell", limitPrice: 59000, amountUsd: 10 }, condition: null, budgetUsd: null }),
    drive: () => ({ title: "Drive", why: "trip", ask: "Plan it?", research: [{ tool: "drive_route", args: { stops: "Vancouver|Seattle" }, label: "Route", why: "hours" }], action: { kind: "itinerary", stops: ["Vancouver", "Seattle"], hoursPerDay: 6 }, condition: null, budgetUsd: null }),
  };
  /** Stands in for the specialist agents: each brief names the move to build. */
  const build: import("@/server/tools").BuildStep = (agent, brief, id) => tools.validateProposal(agent, brief === "sell" ? move.sellCoin() : brief === "drive" ? move.drive() : move.order(brief === "big order" ? 40 : 5), id);
  const step = (agent: string, brief: string, after: number[] = [], gate = "done", useProceeds = false) => ({ agent, brief: brief.padEnd(8, " "), after, gate, useProceeds });
  const plan = async (steps: ReturnType<typeof step>[]) => {
    const v = await tools.validatePlan({ title: "A plan", why: "because", unavailable: [], steps }, `p${Math.random().toString(36).slice(2, 8)}`, (a, b, i) => build(a, b.trim(), i));
    if ("error" in v) throw new Error(v.error);
    return v.plan;
  };
  const begin = async (p: Awaited<ReturnType<typeof plan>>) => {
    const r = await orch.createRun({ agent: "inso", task: "hello there, a plan please" });
    orch.offerPlan(r.id, p);
    await orch.startPlan(r.id, p.id);
    return r.id;
  };

  it("stop cancels the running step and skips the rest", async () => {
    pause();
    const p = await plan([step("travo", "drive"), step("inso", "order", [1])]);
    const id = await begin(p);
    await until(() => orch.getRun(id)!.plan?.steps[0].status === "running", "step 1 to start");
    await orch.stopPlan(id);
    hold.release();
    const after = orch.getRun(id)!;
    expect(after.plan!.status).toBe("stopped");
    expect(after.plan!.steps[1]).toMatchObject({ status: "skipped", note: "Plan stopped" });
    await until(() => orch.getRun(after.plan!.steps[0].runId!)!.status === "cancelled", "step 1 to cancel");
  });

  it("each step is built by its own agent, and the plan's shape is checked", async () => {
    const check = (steps: ReturnType<typeof step>[]) => tools.validatePlan({ title: "x", why: "y", unavailable: [], steps }, "px", (a, b, i) => build(a, b.trim(), i));
    const wrongAgent = await check([step("inso", "drive"), step("travo", "drive")]);
    expect("error" in wrongAgent && wrongAgent.error).toMatch(/Step 1 \(inso\): This agent can't do itinerary/);
    const forward = await check([step("travo", "drive", [2]), step("travo", "drive")]);
    expect("error" in forward && forward.error).toMatch(/can only wait for steps before it/);
    const noOrder = await check([step("travo", "drive"), step("inso", "order", [1], "filled")]);
    expect("error" in noOrder && noOrder.error).toMatch(/places no order/);
    const noSell = await check([step("inso", "order"), step("inso", "order", [1], "filled", true)]);
    expect("error" in noSell && noSell.error).toMatch(/exactly one step that sells/);
    const ok = await check([step("trado", "sell"), step("inso", "order", [1], "filled", true), step("travo", "drive")]);
    expect("plan" in ok && ok.plan.steps.map((s) => s.after)).toEqual([[], ["s1"], []]);
  });

  it("steps that don't depend on each other run at the same time; the one that waits starts after both", async () => {
    pause();
    const id = await begin(await plan([step("travo", "drive"), step("travo", "drive"), step("travo", "drive", [1, 2])]));
    await until(() => orch.getRun(id)!.plan!.steps.slice(0, 2).every((s) => s.status === "running"), "both independent steps to be running together");
    expect(orch.getRun(id)!.plan!.steps[2].status).toBe("waiting");
    hold.release();
    await until(() => orch.getRun(id)!.plan?.status === "done", "the plan to finish");
    const done = orch.getRun(id)!.plan!;
    expect(done.steps.map((s) => s.status)).toEqual(["done", "done", "done"]);
    const [a, b, c] = done.steps.map((s) => orch.getRun(s.runId!)!);
    expect(Date.parse(c.createdAt)).toBeGreaterThanOrEqual(Math.max(Date.parse(a.finishedAt!), Date.parse(b.finishedAt!)));
    // The step that waited was told what the two before it did.
    expect(c.handoff).toMatch(/Travo: .+ · Travo: /);
  });

  it("a step can spend what an earlier sell brought in", async () => {
    const id = await begin(await plan([step("trado", "sell"), step("inso", "big order", [1], "filled", true)]));
    await until(() => orch.getRun(id)!.plan?.status === "done", "the plan to finish");
    const [sell, buy] = orch.getRun(id)!.plan!.steps;
    expect([sell.status, buy.status]).toEqual(["done", "done"]);
    const bought = orch.getRun(buy.runId!)!;
    // The $10 the sell brought in buys 19 contracts at 52¢, not the 40 first drafted.
    expect(bought.proposal!.action).toMatchObject({ kind: "prediction_order", quantity: 19 });
    expect(bought.proposal!.budgetUsd).toBe(10);
    expect(bought.handoff).toMatch(/Budget for this step: \$10\.00/);
  });

  it("a failed step only stops the steps that depended on it", async () => {
    pause();
    const id = await begin(await plan([step("travo", "drive"), step("inso", "order"), step("travo", "drive", [1])]));
    await until(() => orch.getRun(id)!.plan!.steps[0].status === "running" && Boolean(orch.getRun(id)!.plan!.steps[0].runId), "step 1 to start");
    await orch.cancel(orch.getRun(id)!.plan!.steps[0].runId!);
    hold.release();
    await until(() => orch.getRun(id)!.plan?.status === "done", "the plan to settle");
    const steps = orch.getRun(id)!.plan!.steps;
    expect(steps.map((s) => s.status)).toEqual(["failed", "done", "skipped"]);
    expect(steps[2].note).toMatch(/Step 1 didn't go through/);
  });
});
