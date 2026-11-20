import { describe, expect, it } from "vitest";
import type { Plan, PlanStep, Proposal } from "@/lib/types";
import { editPlan } from "./plan-edit";

const sell: Proposal["action"] = { kind: "spot_order", symbol: "btcusd", side: "sell", amountUsd: 20, limitPrice: 60000 } as Proposal["action"];
const move = (title: string, action?: Proposal["action"]): Proposal => ({ id: title, title, why: "", ask: "", venue: "paper", research: [], action });
const step = (id: string, title: string, extra: Partial<PlanStep> = {}): PlanStep => ({ id, agent: "trado", proposal: move(title), after: [], gate: "done", status: "waiting", ...extra });

// s1 sells BTC; s2 spends what the sale brought in; s3 reads what s1 found.
const plan: Plan = {
  id: "p",
  title: "t",
  why: "",
  unavailable: [],
  status: "proposed",
  steps: [
    step("s1", "Sell BTC", { proposal: move("Sell BTC", sell) }),
    step("s2", "Buy ETH with it", { after: ["s1"], gate: "filled", useProceeds: true }),
    step("s3", "Report on it", { after: ["s1"], usesFindings: true }),
  ],
};
// Rebuilding a step with the brief: here it no longer places an order.
const build = async (_agent: string, brief: string) => ({ proposal: move(brief.split(". Change: ")[1] ?? brief) });

describe("changing a plan step tells you what it did to the others", () => {
  it("names the steps that wait differently, and the one that will use the new result", async () => {
    const r = await editPlan(plan, { op: "change", step: "s1", brief: "Just check the BTC price" }, build as never);
    if ("error" in r) throw new Error(r.error);
    expect(r.plan.steps[1]).toMatchObject({ gate: "done", useProceeds: undefined });
    expect(r.plan.editNotes).toEqual([
      "“Buy ETH with it” still starts after “Just check the BTC price”.",
      "“Buy ETH with it” now starts when the steps before it finish, since none of them places an order anymore.",
      "“Buy ETH with it” now uses its own budget, not money from a sale.",
      "“Report on it” will use the new result of “Just check the BTC price” when it starts.",
    ]);
  });

  it("says who no longer waits when a step is removed", async () => {
    const r = await editPlan(plan, { op: "remove", step: "s1" }, build as never);
    if ("error" in r) throw new Error(r.error);
    expect(r.plan.steps.map((s) => s.after)).toEqual([[], []]);
    expect(r.plan.editNotes).toContain("“Report on it” no longer waits for “Sell BTC”.");
  });
});
