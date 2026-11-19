import { beforeEach, describe, expect, it } from "vitest";
import { afterCheck, conditionMet, createWatch, dueWatches, expireOverdue, resetWatches, saveWatch, stepsFor, stopWatch, watchById, type Watch } from "./watches";
import type { ResearchStep, Run } from "@/lib/types";

const step = (id: string, extra: Partial<ResearchStep> = {}): ResearchStep => ({ id, tool: "service", args: { url: `https://${id}.test`, input: "{}", price: "1000", payTo: "0x1" }, label: id, why: "", ...extra });
const research = [step("r1"), step("r2", { bind: { phone: "$r1.seller.phone" } }), step("r3"), step("r4", { onConflict: "g" })];
const run = { id: "j1", agent: "worko", status: "done", network: "testnet", proposal: { id: "p1", title: "Check the seller", why: "", ask: "", venue: "paper", research } } as unknown as Run;

beforeEach(() => resetWatches());

describe("watches", () => {
  it("run only the steps the condition needs: the one it reads and what that one reads from", () => {
    expect(stepsFor(research, "$r2.risk").map((s) => s.id)).toEqual(["r1", "r2"]);
    expect(stepsFor(research, "$r3.price").map((s) => s.id)).toEqual(["r3"]);
  });

  it("are capped before anything runs: per check, number of checks and total", () => {
    const w = createWatch(run, { condition: { ref: "$r2.risk", op: "changed" }, every: "6h", days: 3 }) as Watch;
    expect(w).toMatchObject({ maxChecks: 12, perCheckCapUsd: 0.002, totalCapUsd: 0.024, status: "active" });
    expect(createWatch({ ...run, status: "running" } as Run, { condition: { ref: "$r1.x", op: "changed" }, every: "1h", days: 1 })).toEqual({ error: "Only a finished job can be watched" });
  });

  it.each([
    [{ op: "<=", value: 300 }, 280, undefined, true],
    [{ op: "<=", value: 300 }, "$320", undefined, false],
    [{ op: ">=", value: 0.7 }, 0.8, undefined, true],
    [{ op: "==", value: "high" }, "High", undefined, true],
    [{ op: "!=", value: "high" }, "low", undefined, true],
    [{ op: "changed" }, "low", "low", false],
    [{ op: "changed" }, "high", "low", true],
    [{ op: "changed" }, "high", undefined, false],
  ] as const)("%j with %j (before %j) → %s", (c, value, previous, want) => expect(conditionMet({ ref: "$r1.x", ...c } as never, value, previous)).toBe(want));

  it("are due when active and their time has come, never twice at once", () => {
    const w = createWatch(run, { condition: { ref: "$r1.x", op: "changed" }, every: "1h", days: 1 }) as Watch;
    expect(dueWatches().map((x) => x.id)).toEqual([w.id]);
    expect(dueWatches(Date.now(), new Set([w.id]))).toEqual([]);
    saveWatch({ ...w, nextAt: new Date(Date.now() + 60_000).toISOString() });
    expect(dueWatches()).toEqual([]);
  });

  it("trigger when the condition is met; a check that didn't deliver never counts", () => {
    const w = createWatch(run, { condition: { ref: "$r1.price", op: "<=", value: 300 }, every: "1h", days: 1 }) as Watch;
    const a = afterCheck(w, { value: 350, cost: 0.001 });
    expect(a).toMatchObject({ status: "active" });
    const failed = afterCheck(a, { value: 100, cost: 0.001, failed: "The check didn't deliver" });
    expect(failed.checks.at(-1)!.met).toBe(false);
    expect(failed.status).toBe("active");
    expect(afterCheck(failed, { value: 290, cost: 0.001 })).toMatchObject({ status: "triggered" });
  });

  it("stop at their number of checks, their total, their end date, or when stopped", () => {
    const w = createWatch(run, { condition: { ref: "$r1.price", op: "<=", value: 1 }, every: "1d", days: 2 }) as Watch;
    const once = afterCheck(w, { value: 5, cost: 0.001 });
    expect(afterCheck(once, { value: 5, cost: 0.001 }).status).toBe("expired");
    expect(afterCheck({ ...w, totalCapUsd: 0.0015 }, { value: 5, cost: 0.001 }).status).toBe("out_of_funds");
    saveWatch({ ...w, until: new Date(Date.now() - 1000).toISOString() });
    expireOverdue();
    expect(watchById(w.id)!.status).toBe("expired");
    const v = createWatch(run, { condition: { ref: "$r1.x", op: "changed" }, every: "1h", days: 1 }) as Watch;
    expect(stopWatch(v.id)!.status).toBe("stopped");
    expect(dueWatches().map((x) => x.id)).not.toContain(v.id);
  });
});
