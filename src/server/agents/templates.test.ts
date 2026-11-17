import { describe, expect, it } from "vitest";
import type { Proposal } from "@/lib/types";
import { planFromProposal } from "./toolbox";

const base: Proposal = { id: "p", title: "t", why: "w", ask: "a", research: [], venue: "paper" };
const look = (id: string) => ({ id, tool: "odds_history", args: { symbol: "GEMI-X", tf: "15m" }, label: `Look ${id}`, why: "w" });
const order = { kind: "prediction_order" as const, eventTicker: "E", symbol: "GEMI-X", label: "X", side: "yes" as const, orderType: "limit" as const, maxPrice: 0.4, quantity: 2 };
const ids = (p: Proposal) => planFromProposal(p).phases.map((x) => `${x.id}<${x.dependsOn.join(",")}>`);

describe("the steps follow the kind of task", () => {
  it("a question: only the lookups it needs, then a write-up", () => {
    expect(ids({ ...base, research: [look("r1"), look("r2"), look("r3")] })).toEqual(["r1<>", "r2<>", "r3<>", "check<r1,r2,r3>"]);
  });

  it("a plain trade: lookups straight into the order, no empty check or report box", () => {
    expect(ids({ ...base, research: [look("r1")], action: order })).toEqual(["r1<>", "act<r1>"]);
    expect(ids({ ...base, action: order })).toEqual(["act<>"]);
  });

  it("check, then trade: the check sits between the lookups and the order", () => {
    expect(ids({ ...base, research: [look("r1")], action: order, condition: { metric: "yes_price", symbol: "GEMI-X", op: "<=", value: 0.4 } })).toEqual(["r1<>", "check<r1>", "act<check>"]);
  });

  it("a real exchange order gets a step that watches it fill; a simulation doesn't", () => {
    expect(ids({ ...base, action: order, venue: "gemini-sandbox" })).toEqual(["act<>", "watch<act>"]);
    expect(ids({ ...base, action: order, venue: "paper" })).not.toContain("watch<act>");
  });

  it("a trip: route, then the days", () => {
    expect(ids({ ...base, research: [{ id: "r1", tool: "drive_route", args: { stops: "A|B" }, label: "Route", why: "w" }], action: { kind: "itinerary", stops: ["A", "B"], hoursPerDay: 6 } })).toEqual(["r1<>", "act<r1>"]);
  });
});

describe("the plan board's sub-tasks are the step's real phases", () => {
  it("same ids and labels, in the same order, for every kind of move", async () => {
    const { partsOf } = await import("@/lib/parts");
    const cases: Proposal[] = [
      { ...base, research: [look("r1"), look("r2")] },
      { ...base, research: [look("r1")], action: order },
      { ...base, research: [look("r1")], action: order, venue: "gemini-sandbox", condition: { metric: "yes_price", symbol: "GEMI-X", op: "<=", value: 0.4 } },
      { ...base, action: { ...order, trade: "sell" as const } },
      { ...base, research: [{ id: "r1", tool: "drive_route", args: { stops: "A|B" }, label: "Route", why: "w" }], action: { kind: "itinerary", stops: ["A", "B"], hoursPerDay: 6 } },
    ];
    for (const p of cases) expect(partsOf(p).map((x) => [x.id, x.label])).toEqual(planFromProposal(p).phases.map((x) => [x.id, x.label]));
  });
});
