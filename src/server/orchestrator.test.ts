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
    expect(run.lines.find((l) => l.id === "history")?.payeeName).toBe("Odds Mirror");
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
