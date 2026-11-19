import { beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

process.env.DEMO_DELAY_SCALE = "0";
process.env.AI_DISABLED = "true";

vi.mock("@/server/agents/ai-planning", async (orig) => ({ ...(await orig<typeof import("@/server/agents/ai-planning")>()), spotSymbols: async () => ["btcusd"] }));
vi.mock("@/server/gemini", async (orig) => ({
  ...(await orig<typeof import("@/server/gemini")>()),
  getEvent: async () => ({ ticker: "BTC-1", title: "BTC today", category: "Crypto", volume: 10, contracts: [{ symbol: "GEMI-BTC-A", label: "A", last: 0.5, bid: 0.49, ask: 0.51, open: true }] }),
}));
vi.mock("@/server/geo", () => ({
  geocode: async (q: string) => ({ name: q, lat: 49 - q.length / 10, lon: -123 + q.length / 10 }),
  nearby: async () => [],
  drive: async (stops: { name: string }[]) => ({ distanceKm: 230, hours: 2.5, path: stops.map((_, i) => [-123 + i, 49 - i] as [number, number]), legs: stops.slice(1).map(() => ({ distanceKm: 230, hours: 2.5 })) }),
}));

let client: Client;
let orch: typeof import("@/server/orchestrator");
beforeAll(async () => {
  orch = await import("@/server/orchestrator");
  const { buildMcpServer } = await import("./mcp");
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildMcpServer("http://app.test").connect(a);
  client = new Client({ name: "test", version: "0" });
  await client.connect(b);
});

const order = { title: "Buy YES: BTC A", why: "coin flip", ask: "Buy 5 YES at 52¢ or less?", research: [], action: { kind: "prediction_order", eventTicker: "BTC-1", symbol: "GEMI-BTC-A", label: "A", side: "yes", orderType: "limit", maxPrice: 0.52, stopPrice: null, quantity: 5 }, condition: null, budgetUsd: null };
const trip = { title: "Drive Vancouver to Seattle", why: "the trip", ask: "Plan the drive?", research: [{ tool: "drive_route", args: { stops: "Vancouver|Seattle" }, label: "Route", why: "hours" }], action: { kind: "itinerary", stops: ["Vancouver", "Seattle"], hoursPerDay: 6 }, condition: null, budgetUsd: null };
const call = async (name: string, args: Record<string, unknown>) => {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  return { error: Boolean(r.isError), text: r.content[0].text, json: () => JSON.parse(r.content[0].text) };
};

describe("plans for outside AIs (MCP)", () => {
  it("offers propose_plan alongside the other tools", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_agents", "look_up", "propose_move", "propose_plan", "get_job"]));
  });

  it("checks every move and the plan's shape, then leaves starting it to the user", async () => {
    const r = await call("propose_plan", { task: "Bet on BTC, then plan my drive", title: "Bet, then drive", why: "Two things, one after the other", steps: [{ agent: "inso", move: order }, { agent: "worko", move: trip, after: [1] }] });
    expect(r.error).toBe(false);
    const job = r.json();
    expect(job.plan).toMatchObject({ title: "Bet, then drive", status: "proposed" });
    expect(job.plan.steps.map((s: { agent: string; waitsFor: string[]; status: string }) => [s.agent, s.waitsFor, s.status])).toEqual([
      ["inso", [], "waiting"],
      ["worko", ["s1"], "waiting"],
    ]);
    expect(job.nextStep).toMatch(/waiting for the user to start it at http:\/\/app\.test\/runs\/.+ You cannot start it/);
    // Nothing is priced, funded or run until the user starts it.
    expect(orch.getRun(job.id)!.lines).toHaveLength(0);

    // Once the user starts it in the app, get_job follows the steps.
    const plan = orch.getRun(job.id)!.chat!.find((m) => m.plan)!.plan!;
    await orch.startPlan(job.id, plan.id);
    for (let i = 0; i < 600 && orch.getRun(job.id)!.plan?.status !== "done"; i++) await new Promise((res) => setTimeout(res, 5));
    const after = (await call("get_job", { id: job.id })).json();
    expect(after.plan.status).toBe("done");
    expect(after.plan.steps.map((s: { status: string; job?: string }) => [s.status, Boolean(s.job)])).toEqual([
      ["done", true],
      ["done", true],
    ]);
  });

  it("refuses a plan with a bad move or a bad shape, with the reason", async () => {
    const wrongAgent = await call("propose_plan", { task: "x y z", title: "t", why: "w", steps: [{ agent: "worko", move: order }, { agent: "worko", move: trip }] });
    expect(wrongAgent.error).toBe(true);
    expect(wrongAgent.text).toMatch(/Step 1 \(worko\): This agent can't do prediction_order/);
    const noOrder = await call("propose_plan", { task: "x y z", title: "t", why: "w", steps: [{ agent: "worko", move: trip }, { agent: "inso", move: order, after: [1], gate: "filled" }] });
    expect(noOrder.error).toBe(true);
    expect(noOrder.text).toMatch(/places an order/);
  });
});
