import { describe, expect, it } from "vitest";
import { gridLayout, laneLayout, LANE_LABEL_W, NODE_W, GAP_X } from "./layout";
import type { Phase } from "@/lib/types";

const ph = (id: string, dependsOn: string[] = [], lane?: string): Phase => ({ id, label: id, sub: "", status: "planned", dependsOn, optional: true, payments: [], lane });

describe("graph layout", () => {
  it("without lanes, positions are exactly as before", () => {
    const phases = [ph("r1"), ph("r2"), ph("check", ["r1", "r2"]), ph("act", ["check"])];
    const l = gridLayout(phases, 1200);
    expect(l.vertical).toBe(false);
    expect(l.pos).toEqual({ r1: { x: 0, y: 0 }, r2: { x: 0, y: 110 }, check: { x: 252, y: 55 }, act: { x: 504, y: 55 } });
    expect([l.w, l.h]).toEqual([700, 198]);
    // Narrow: top to bottom.
    const v = gridLayout(phases, 400);
    expect(v.vertical).toBe(true);
    expect(v.pos.check).toEqual({ x: 109, y: 128 });
  });

  it("with lanes, each question is a band, columns still follow what waits on what", () => {
    const lanes = [
      { id: "f1", question: "Is the phone risky?", importance: "must" as const },
      { id: "f2", question: "What do reviews say?", importance: "should" as const },
    ];
    const phases = [ph("s1", [], "f1"), ph("s2", ["s1"], "f1"), ph("s3", ["s1"], "f1"), ph("s4", [], "f2"), ph("x")];
    const l = laneLayout(phases, lanes);
    expect(l.bands!.map((b) => b.id)).toEqual(["f1", "f2", "__other"]);
    const [b1, b2] = l.bands!;
    for (const id of ["s1", "s2", "s3"]) expect(l.pos[id].y).toBeGreaterThanOrEqual(b1.y);
    expect(l.pos.s4.y).toBeGreaterThanOrEqual(b2.y);
    expect(l.pos.s2.x).toBe(LANE_LABEL_W + NODE_W + GAP_X);
    // Two steps in one lane and column stack inside the band.
    expect(l.pos.s3.y).not.toBe(l.pos.s2.y);
    // The verdict sits right of every step, and each lane's last step leads to it.
    expect(l.verdict!.x).toBeGreaterThan(Math.max(...Object.values(l.pos).map((p) => p.x)) + NODE_W);
    expect(l.laneEnds).toEqual(["s3", "s4"]);
  });
});
