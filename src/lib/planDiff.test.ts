import { describe, expect, it } from "vitest";
import { diffPlans } from "./planDiff";
import type { CostLine, Phase } from "./types";

const ph = (id: string): Phase => ({ id, label: id, sub: "", status: "planned", dependsOn: [], optional: true, payments: [], lineId: id });
const ln = (id: string, approved: string, payeeName = "A"): CostLine => ({ id, phaseId: id, purpose: "", service: "", payeeName, payee: "0x1", rail: "gateway", approved, actual: "0", index: -1, bigSpend: false });

describe("what an edit changed", () => {
  it("finds added and removed steps, a changed price and a changed seller", () => {
    const d = diffPlans({ phases: [ph("r1"), ph("r2"), ph("r3")], lines: [ln("r1", "2000"), ln("r2", "6000"), ln("r3", "1000")] }, { phases: [ph("r1"), ph("r2"), ph("r4")], lines: [ln("r1", "5000"), ln("r2", "6000", "B"), ln("r4", "1000")] });
    expect(d.added).toEqual(["r4"]);
    expect(d.removed.map((p) => p.id)).toEqual(["r3"]);
    expect(d.price).toEqual({ r1: { from: "2000", to: "5000" } });
    expect(d.provider).toEqual({ r2: { from: "A", to: "B" } });
  });
});
