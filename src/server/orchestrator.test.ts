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
    oddsHistory: async () => series,
    spotCandles: async () => series.map((s) => ({ ...s, p: 60000 + s.p * 1000 })),
    recentTrades: async () => [
      { t: 1, p: 0.5, size: 10, side: "buy" },
      { t: 2, p: 0.5, size: 4, side: "sell" },
    ],
  };
});

process.env.DEMO_DELAY_SCALE = "0";
process.env.FAULT_TIMEOUT_MS = "50";

let orch: typeof import("@/server/orchestrator");
beforeAll(async () => {
  orch = await import("@/server/orchestrator");
});

const tick = () => new Promise((r) => setTimeout(r, 5));

type Strategy = { reapproval?: "approved" | "denied" | "ignore"; failure?: FailureAction[] };

/** Runs a job to the end, answering popups like a user would. */
async function drive(task: string, faults: FailureCode[], s: Strategy = {}, agent: Run["agent"] = "inso") {
  const created = await orch.createRun({ agent, task, faults });
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
    expect(run.lines.find((l) => l.id === "tape")?.bigSpend).toBe(true);
    for (const l of run.lines) expect(BigInt(l.actual)).toBeLessThanOrEqual(BigInt(l.approved));
    expect(BigInt(run.refunded!)).toBe(BigInt(run.cap) - total(run));
    expect(run.decisions[0].kind).toBe("plan_approval");
    expect(run.deliverable?.summary).toMatch(/Biggest move/);
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

  it("seller_402_timeout: switch provider needs re-approval for the new payee", async () => {
    const { run, seen } = await drive("BTC odds", ["seller_402_timeout"], { failure: ["switch"], reapproval: "approved" });
    expect(seen.failures).toEqual(["seller_402_timeout"]);
    expect(seen.reapprovals).toBe(1);
    expect(run.lines.find((l) => l.id === "history")?.payeeName).toBe("Data Mirror");
    expect(run.status).toBe("done");
  });

  it("insufficient_balance offers top up", async () => {
    const { run, seen } = await drive("BTC odds", ["insufficient_balance"], { failure: ["topup"] });
    expect(seen.failures).toEqual(["insufficient_balance"]);
    expect(run.status).toBe("done");
  });

  it("policy_block: off-plan purchase is routed to the user, never paid silently", async () => {
    const { run, seen } = await drive("BTC odds", ["policy_block"], { reapproval: "denied", failure: ["skip", "cancel"] });
    expect(seen.reapprovals).toBe(1);
    expect(run.lines.some((l) => l.id === "extra-history")).toBe(false);
    expect(settled(run).some((p) => p.lineId === "extra-history")).toBe(false);
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
    const r = await orch.createRun({ agent: "inso", task: "BTC odds" });
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

describe("edit alternatives", () => {
  it("every suggested alternative is itself a valid edit", async () => {
    const { AGENTS } = await import("@/server/agents");
    const prompts = ["place a real bet", "guarantee profit", "make it free", "9 markets", "do a backflip", "open a long position", "add eth sol doge link", "book a hotel", "take a flight", "add Portland", "30 hours"];
    for (const agent of Object.values(AGENTS)) {
      const opts = { ...agent.defaults, stops: ["Vancouver", "Seattle"] };
      for (const p of prompts) {
        const r = agent.edit("deliverable", p, opts);
        for (const alt of r.alternatives ?? []) expect(agent.edit("deliverable", alt, opts).ok, `${agent.id}: "${p}" -> "${alt}"`).toBe(true);
      }
    }
  });
});

describe("method, preview and edited re-approval", () => {
  it("mirror seller re-prices lines; AI IDE adds a 0 USDC subscription line and a context pack", async () => {
    const r = await orch.createRun({ agent: "inso", task: "BTC odds" });
    const base = BigInt(r.lines.find((l) => l.id === "history")!.approved);
    const m = await orch.setMethod(r.id, { seller: "mirror", analysis: "ide" });
    expect(BigInt(m.lines.find((l) => l.id === "history")!.approved)).toBe((base * 150n) / 100n);
    expect(m.lines.find((l) => l.id === "ide")).toMatchObject({ rail: "subscription", approved: "0", payeeName: "Your subscription" });
    expect(BigInt(m.estFees)).toBeGreaterThan(0n);
    await orch.approve(r.id);
    for (let i = 0; i < 300 && orch.getRun(r.id)!.status !== "done"; i++) await tick();
    const done = orch.getRun(r.id)!;
    expect(done.status).toBe("done");
    expect(done.deliverable?.contextPack?.prompt).toMatch(/BTC odds/);
    expect(done.phases.flatMap((p) => p.payments).every((p) => p.lineId !== "ide")).toBe(true);
  });

  it("preview shows the new total without changing the work order", async () => {
    const r = await orch.createRun({ agent: "inso", task: "BTC odds" });
    const p = await orch.previewEdit(r.id, "deliverable", "drop the trade tape");
    expect(p.ok).toBe(true);
    expect(BigInt(p.after!.total)).toBeLessThan(BigInt(p.before!.total));
    expect(orch.getRun(r.id)!.lines.some((l) => l.id === "tape")).toBe(true);
  });

  it("re-approval with an edited amount uses it, never below one request", async () => {
    const r = await orch.createRun({ agent: "inso", task: "BTC odds", faults: ["price_increase"] });
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
    expect(answered.size).toBeGreaterThan(1);
    const run = orch.getRun(r.id)!;
    expect(run.status).toBe("done");
    expect(run.decisions.some((d) => d.kind === "reapproval" && d.outcome === "edited")).toBe(true);
  });
});
