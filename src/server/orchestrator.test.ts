import { beforeAll, describe, expect, it, vi } from "vitest";
import type { FailureAction, FailureCode, Run } from "@/lib/types";

vi.mock("@/server/gemini", async (orig) => {
  const real = await orig<typeof import("@/server/gemini")>();
  const series = Array.from({ length: 20 }, (_, i) => ({ t: i * 60_000, p: 0.4 + i * 0.01 }));
  return {
    ...real,
    searchEvents: async (q: string) => [
      { ticker: `${q}-1`, title: `${q} event A`, category: "Crypto", volume: 10, contracts: [{ symbol: `GEMI-${q}-A`, label: "A", last: 0.5, bid: 0.49, ask: 0.51 }] },
      { ticker: `${q}-2`, title: `${q} event B`, category: "Crypto", volume: 9, contracts: [{ symbol: `GEMI-${q}-B`, label: "B", last: 0.3, bid: 0.29, ask: 0.31 }] },
      { ticker: `${q}-3`, title: `${q} event C`, category: "Crypto", volume: 8, contracts: [{ symbol: `GEMI-${q}-C`, label: "C", last: 0.7, bid: 0.69, ask: 0.71 }] },
    ],
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
vi.mock("@/server/nanopay", async (orig) => ({ ...(await orig<typeof import("@/server/nanopay")>()), gatewayBalance: async () => 1, depositToGateway: async () => ({}) }));

process.env.DEMO_DELAY_SCALE = "0";
process.env.AI_DISABLED = "true";
process.env.FAULT_TIMEOUT_MS = "50";

let orch: typeof import("@/server/orchestrator");
beforeAll(async () => {
  orch = await import("@/server/orchestrator");
});

const tick = () => new Promise((r) => setTimeout(r, 5));

type Strategy = { reapproval?: "approved" | "denied" | "ignore"; failure?: FailureAction[] };

/** Chat, then say yes to the agent's move: a priced draft. */
async function draft(task: string, faults: FailureCode[] = [], agent: Run["agent"] = "inso") {
  const created = await orch.createRun({ agent, task, faults });
  const move = created.chat?.find((m) => m.proposal)?.proposal;
  if (!move) throw new Error("no move proposed: " + JSON.stringify(created.chat));
  return orch.adopt(created.id, move.id);
}

/** Runs a job to the end, answering popups like a user would. */
async function drive(task: string, faults: FailureCode[], s: Strategy = {}, agent: Run["agent"] = "inso") {
  const created = await draft(task, faults, agent);
  await orch.approve(created.id);
  const actions = [...(s.failure ?? [])];
  const seen = { reapprovals: 0, failures: [] as FailureCode[] };
  for (let i = 0; i < 300; i++) {
    const run = orch.getRun(created.id)!;
    if (run.status === "done" || run.status === "cancelled") return { run, seen };
    const r = run.pendingReapprovals[0];
    if (r && s.reapproval !== "ignore") {
      seen.reapprovals++;
      orch.decideReapproval(run.id, r.id, s.reapproval ?? "approved");
    }
    const f = run.pendingFailures[0];
    if (f) {
      seen.failures.push(f.code);
      const a = actions.shift() ?? "cancel";
      orch.resolveFailure(run.id, f.id, f.options.includes(a) ? a : "cancel");
    }
    await tick();
  }
  const r = orch.getRun(created.id)!;
  throw new Error("run did not finish " + JSON.stringify({ status: r.status, phases: r.phases.map((p) => [p.id, p.status]), pr: r.pendingReapprovals.length, pf: r.pendingFailures, d: r.decisions.map((d) => d.outcome) }));
}

const total = (run: Run) => run.lines.reduce((a, l) => a + BigInt(l.actual), 0n);
const settled = (run: Run) => run.phases.flatMap((p) => p.payments).filter((p) => p.txState === "settled");

describe("orchestrator (demo rail)", () => {
  it("runs a plan end to end with pre-approved big spend and no popups", async () => {
    const { run, seen } = await drive("How have BTC odds moved?", []);
    expect(run.status).toBe("done");
    expect(seen.reapprovals).toBe(0);
    expect(run.lines.find((l) => l.id === "order")).toMatchObject({ rail: "exchange", bigSpend: true, index: -1 });
    for (const l of run.lines) expect(BigInt(l.actual)).toBeLessThanOrEqual(BigInt(l.approved));
    expect(BigInt(run.refunded!)).toBe(BigInt(run.cap) - total(run));
    expect(run.decisions.some((d) => d.kind === "plan_approval")).toBe(true);
    // No exchange keys in tests: the order is honestly a simulation, never presented as placed.
    expect(run.order).toMatchObject({ venue: "paper", status: "simulated" });
    expect(run.proposal?.venue).toBe("paper");
    expect(run.deliverable?.summary).toMatch(/Simulated/);
  });

  it("price_increase asks for re-approval, then pays the new price", async () => {
    const { run, seen } = await drive("BTC odds", ["price_increase"], { reapproval: "approved" });
    expect(seen.reapprovals).toBe(1);
    expect(run.status).toBe("done");
    expect(run.decisions.some((d) => d.kind === "reapproval" && d.outcome === "approved")).toBe(true);
  });

  it("denied re-approval becomes a failure; skip is not offered for required steps", async () => {
    const { run, seen } = await drive("BTC odds", ["price_increase"], { reapproval: "denied", failure: ["cancel"] });
    expect(seen.failures).toEqual(["policy_block"]);
    expect(run.status).toBe("cancelled");
    expect(BigInt(run.refunded!)).toBe(BigInt(run.cap) - total(run));
  });

  it("approval_timeout counts as deny", async () => {
    const { run, seen } = await drive("BTC odds", ["approval_timeout"], { reapproval: "ignore", failure: ["retry"] });
    expect(seen.failures).toEqual(["approval_timeout"]);
    expect(run.decisions.some((d) => d.outcome === "timed_out" && d.by === "system")).toBe(true);
    expect(run.status).toBe("done");
  });

  it.each(["seller_402_timeout", "payment_rejected", "settle_fails"] as const)("%s: retry succeeds without paying twice", async (fault) => {
    const { run, seen } = await drive("BTC odds", [fault], { failure: ["retry"] });
    expect(seen.failures).toEqual([fault]);
    expect(run.status).toBe("done");
    const keys = settled(run).map((p) => p.id);
    expect(new Set(keys).size).toBe(keys.length);
    expect(total(run)).toBe(settled(run).reduce((a, p) => a + BigInt(p.amount!), 0n));
  });

  it("insufficient_balance offers top up", async () => {
    const { run, seen } = await drive("BTC odds", ["insufficient_balance"], { failure: ["topup"] });
    expect(seen.failures).toEqual(["insufficient_balance"]);
    expect(run.status).toBe("done");
  });

  it("policy_block: off-plan purchase is routed to the user, never paid silently", async () => {
    const { run, seen } = await drive("BTC odds", ["policy_block"], { reapproval: "denied", failure: ["skip", "cancel"] });
    expect(seen.reapprovals).toBe(1);
    expect(run.lines.some((l) => l.id === "extra")).toBe(false);
    expect(settled(run).some((p) => p.lineId === "extra")).toBe(false);
  });

  it("model_error: retry", async () => {
    const { run, seen } = await drive("BTC odds", ["model_error"], { failure: ["retry"] });
    expect(seen.failures).toEqual(["model_error"]);
    expect(run.status).toBe("done");
  });

  it("skipping an optional step releases its cost", async () => {
    const { run } = await drive("BTC odds", ["model_error"], { failure: ["cancel"] });
    expect(run.status).toBe("cancelled");
  });

  it("card edits re-price, and impossible edits explain why", async () => {
    const r = await draft("BTC odds");
    const before = r.cap;
    const edited = await orch.editCard(r.id, "deliverable", "drop the trade tape");
    expect(edited.editNote?.ok).toBe(true);
    expect(BigInt(edited.cap)).toBeLessThan(BigInt(before));
    const no = await orch.editCard(r.id, "method", "place a real bet on yes");
    expect(no.editNote?.ok).toBe(false);
    expect(no.editNote?.alternatives?.length).toBeGreaterThan(0);
  });

  it("trado runs end to end", async () => {
    const { run } = await drive("Is BTC trending?", [], {}, "trado");
    expect(run.status).toBe("done");
  });
});

describe("explore, then act", () => {
  it("chat is free: a move is proposed, nothing is priced or paid until it's chosen", async () => {
    const r = await orch.createRun({ agent: "inso", task: "What are BTC odds?" });
    expect(r.status).toBe("exploring");
    expect(r.lines).toHaveLength(0);
    const agentMsg = r.chat!.find((m) => m.role === "agent")!;
    expect(agentMsg.tools?.[0]).toMatchObject({ tool: "search_markets", ok: true });
    expect(agentMsg.proposal?.action).toMatchObject({ kind: "prediction_order", side: "yes" });
    await expect(orch.approve(r.id)).rejects.toThrow();
    const d = await orch.adopt(r.id, agentMsg.proposal!.id);
    expect(d.status).toBe("draft");
    expect(d.lines.map((l) => l.id)).toEqual(["r1", "r2", "order"]);
    // The order limit is approved but never sits in the vault.
    const vault = d.lines.filter((l) => l.rail !== "exchange").reduce((a, l) => a + BigInt(l.approved), 0n);
    expect(BigInt(d.cap)).toBe(vault + vault / 5n);
  });

  it("a typed yes sets up the move just shown, without asking the model again", async () => {
    const r = await orch.createRun({ agent: "inso", task: "BTC odds" });
    const shown = r.chat!.find((m) => m.proposal)!.proposal!;
    const after = await orch.sendChat(r.id, "yes!");
    expect(after.status).toBe("draft");
    expect(after.proposal?.id).toBe(shown.id);
    expect(after.chat!.filter((m) => m.proposal)).toHaveLength(1);
  });

  it("back to chat clears the priced order and keeps the conversation", async () => {
    const d = await draft("BTC odds");
    const back = orch.backToChat(d.id);
    expect(back.status).toBe("exploring");
    expect(back.lines).toHaveLength(0);
    expect(back.chat!.length).toBeGreaterThan(1);
    await orch.sendChat(d.id, "what about ETH?");
    expect(orch.getRun(d.id)!.chat!.filter((m) => m.role === "agent")).toHaveLength(2);
  });

  it("the move is skipped when the condition fails on fresh data", async () => {
    const created = await orch.createRun({
      agent: "inso",
      task: "BTC odds",
      proposal: {
        id: "p1",
        title: "Buy YES if cheap",
        why: "test",
        ask: "Buy 5 YES at 20¢ or less?",
        research: [{ id: "r1", tool: "odds_history", args: { symbol: "GEMI-BTC-A", tf: "15m" }, label: "Odds history", why: "trend" }],
        action: { kind: "prediction_order", eventTicker: "BTC-1", symbol: "GEMI-BTC-A", label: "A", side: "yes", orderType: "limit", maxPrice: 0.2, quantity: 5 },
        // A check on a different number: BTC spot must be at or below 50k (it's 60k in the mock).
        condition: { metric: "spot_price", symbol: "btcusd", op: "<=", value: 50000 },
        venue: "paper",
      },
    });
    expect(created.status).toBe("draft");
    await orch.approve(created.id);
    for (let i = 0; i < 300 && orch.getRun(created.id)!.status !== "done"; i++) await tick();
    const run = orch.getRun(created.id)!;
    expect(run.status).toBe("done");
    expect(run.order?.status).toBe("skipped");
    expect(run.deliverable?.summary).toMatch(/Held off/);
  });

  it("a Chainlink price bought from the marketplace gates the order, paid through the same policy", async () => {
    const mk = (value: number) =>
      orch.createRun({
        agent: "inso",
        task: "BTC with oracle check",
        proposal: {
          id: `p-${value}`,
          title: "Buy YES if Chainlink agrees",
          why: "test",
          ask: "Buy 2 YES at 52¢ if Chainlink BTC ≥ value?",
          research: [{ id: "r1", tool: "oracle_price", args: { symbol: "btcusd" }, label: "Chainlink BTC/USD", why: "independent price" }],
          action: { kind: "prediction_order", eventTicker: "BTC-1", symbol: "GEMI-BTC-A", label: "A", side: "yes", orderType: "limit", maxPrice: 0.52, quantity: 2 },
          condition: { metric: "oracle_price", symbol: "btcusd", op: ">=", value },
          venue: "paper",
        },
      });
    for (const [value, expected] of [[60000, "simulated"], [65000, "skipped"]] as const) {
      const r = await mk(value);
      expect(r.lines.find((l) => l.id === "r1")).toMatchObject({ rail: "gateway", approved: "100", payeeName: "Quicknode (Agent Marketplace)" });
      await orch.approve(r.id);
      for (let i = 0; i < 300 && orch.getRun(r.id)!.status !== "done"; i++) await tick();
      const run = orch.getRun(r.id)!;
      expect(run.order?.status).toBe(expected);
      expect(run.lines.find((l) => l.id === "r1")?.actual).toBe("100");
      expect(run.phases.find((p) => p.id === "r1")?.payments[0]).toMatchObject({ txState: "settled", via: "Circle Gateway nanopayment" });
    }
  });

  it("travo plans driving days from a route", async () => {
    const geo = await import("@/server/geo");
    vi.spyOn(geo, "geocode").mockImplementation(async (q) => ({ name: q, lat: 49 + q.length / 10, lon: -123 }));
    vi.spyOn(geo, "drive").mockImplementation(async (stops) => ({ distanceKm: 300, hours: 9, path: stops.map((s) => [s.lon, s.lat]), legs: stops.slice(1).map(() => ({ distanceKm: 150, hours: 4.5 })) }));
    const { run } = await drive("Drive from Vancouver to Portland via Seattle", [], {}, "travo");
    expect(run.status).toBe("done");
    expect((run.deliverable?.data as { days: unknown[] }).days.length).toBeGreaterThan(0);
  });
});

describe("edit alternatives", () => {
  it("every suggested alternative is itself a valid edit", async () => {
    const { AGENTS } = await import("@/server/agents");
    const d = await draft("BTC odds");
    const opts = { proposal: d.proposal };
    const agent = AGENTS.inso;
    for (const p of ["place a real bet", "guarantee profit", "make it free", "do a backflip", "book a hotel"]) {
      const r = agent.edit("deliverable", p, opts);
      for (const alt of r.alternatives ?? []) expect(agent.edit("deliverable", alt, opts).ok, `"${p}" -> "${alt}"`).toBe(true);
    }
  });
});

describe("step edits", () => {
  const P = {
    id: "p1",
    title: "Buy YES if cheap",
    why: "test",
    ask: "Buy 5 YES at 40¢ or less?",
    research: [
      { id: "r1", tool: "odds_history", args: { symbol: "GEMI-BTC-A", tf: "15m" }, label: "Odds history", why: "trend" },
      { id: "r2", tool: "trade_tape", args: { symbol: "GEMI-BTC-A" }, label: "Trade tape", why: "flow" },
    ],
    action: { kind: "prediction_order", eventTicker: "BTC-1", symbol: "GEMI-BTC-A", label: "A", side: "yes", orderType: "limit", maxPrice: 0.4, quantity: 5 },
    condition: { metric: "yes_price", symbol: "GEMI-BTC-A", op: "<=", value: 0.45 },
    venue: "paper",
  } as const;
  const opts = () => ({ proposal: JSON.parse(JSON.stringify(P)) });

  it("drops exactly the step it is aimed at, and changes its timeframe", async () => {
    const { AGENTS } = await import("@/server/agents");
    const drop = AGENTS.inso.edit("method", "drop this step", opts(), "r2");
    expect(drop.ok).toBe(true);
    expect((drop.options!.proposal as typeof P).research.map((r) => r.id)).toEqual(["r1"]);
    const tf = AGENTS.inso.edit("method", "use hourly data", opts(), "r1");
    expect((tf.options!.proposal as typeof P).research[0].args.tf).toBe("1hr");
  });

  it("changes or drops the condition, and resizes or drops the order", async () => {
    const { AGENTS } = await import("@/server/agents");
    const c = AGENTS.inso.edit("method", "only if below 38¢", opts(), "check");
    expect((c.options!.proposal as typeof P).condition).toMatchObject({ op: "<=", value: 0.38 });
    expect(AGENTS.inso.edit("method", "drop the check", opts(), "check").options!.proposal).toMatchObject({ condition: undefined });
    expect((AGENTS.inso.edit("method", "8 contracts", opts(), "act").options!.proposal as typeof P).action.quantity).toBe(8);
    expect(AGENTS.inso.edit("method", "don't place the order", opts(), "act").options!.proposal).toMatchObject({ action: undefined });
  });

  it("every suggested alternative for a step is itself a valid edit", async () => {
    const { AGENTS } = await import("@/server/agents");
    for (const step of ["r1", "r2", "check", "act"])
      for (const p of ["make it better", "hmm", "book a hotel"]) {
        const r = AGENTS.inso.edit("method", p, opts(), step);
        for (const alt of r.alternatives ?? []) expect(AGENTS.inso.edit("method", alt, opts(), step).ok, `${step}: "${p}" -> "${alt}"`).toBe(true);
      }
  });

  it("previews and applies a step edit on a draft, re-pricing the plan", async () => {
    const d = await draft("BTC odds");
    const step = d.phases.find((p) => p.lineId && p.id.startsWith("r"))!;
    const before = d.lines.length;
    const pv = await orch.previewEdit(d.id, "method", "drop this step", step.id);
    expect(pv.ok).toBe(true);
    const after = await orch.editCard(d.id, "method", "drop this step", step.id);
    expect(after.lines.length).toBe(before - 1);
    expect(after.phases.find((p) => p.id === step.id)).toBeUndefined();
  });
});

describe("method, preview and edited re-approval", () => {
  it("preview shows the new total without changing the work order", async () => {
    const r = await draft("BTC odds");
    const p = await orch.previewEdit(r.id, "deliverable", "drop the trade tape");
    expect(p.ok).toBe(true);
    expect(BigInt(p.after!.total)).toBeLessThan(BigInt(p.before!.total));
    expect(orch.getRun(r.id)!.lines.some((l) => l.id === "r2")).toBe(true);
  });

  it("re-approval with an edited amount uses it, never below one request", async () => {
    const r = await draft("BTC odds", ["price_increase"]);
    await orch.approve(r.id);
    const answered = new Set<string>();
    for (let i = 0; i < 600; i++) {
      const run = orch.getRun(r.id)!;
      const q = run.pendingReapprovals.find((x) => !answered.has(x.id));
      if (q) {
        answered.add(q.id);
        // First time: approve just one request's worth; later asks get the default.
        orch.decideReapproval(r.id, q.id, "approved", answered.size === 1 ? "1" : undefined);
      }
      if (run.status === "done") break;
      await tick();
    }
    expect(answered.size).toBeGreaterThanOrEqual(1);
    const run = orch.getRun(r.id)!;
    expect(run.status).toBe("done");
    expect(run.decisions.some((d) => d.kind === "reapproval" && d.outcome === "edited")).toBe(true);
  });
});
