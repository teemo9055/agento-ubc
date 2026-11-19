import { describe, expect, it } from "vitest";
import { tally } from "./verdict";
import type { Phase, Run } from "@/lib/types";

const ph = (id: string, lane: string, tone?: NonNullable<Phase["finding"]>["tone"], status: Phase["status"] = tone ? "done" : "planned"): Phase => ({
  id,
  label: id,
  sub: "",
  status,
  dependsOn: [],
  optional: true,
  payments: [],
  lineId: id,
  lane,
  ...(tone ? { finding: { text: id, tone } } : {}),
});
const lanes: Run["lanes"] = [
  { id: "phone", question: "Is the phone risky?", importance: "must" },
  { id: "photo", question: "Is the photo stolen?", importance: "should" },
  { id: "extra", question: "Anything in the news?", importance: "nice" },
];

describe("the live verdict", () => {
  it("a bad finding on a must question: don't go ahead", () => {
    expect(tally({ lanes, phases: [ph("a", "phone", "bad"), ph("b", "photo", "good")] }).lean).toBe("do_not_proceed");
  });
  it("a bad finding elsewhere, or two warnings: be careful", () => {
    expect(tally({ lanes, phases: [ph("a", "phone", "good"), ph("b", "photo", "bad")] }).lean).toBe("be_careful");
    expect(tally({ lanes, phases: [ph("a", "phone", "warn"), ph("b", "photo", "warn")] }).lean).toBe("be_careful");
  });
  it("every must question answered calmly: looks fine", () => {
    expect(tally({ lanes, phases: [ph("a", "phone", "good"), ph("b", "photo", "neutral")] }).lean).toBe("looks_fine");
  });
  it("still waiting on a must question: still checking, with pending counted", () => {
    const v = tally({ lanes, phases: [ph("a", "phone"), ph("b", "photo", "good")] });
    expect(v).toMatchObject({ lean: "unclear", pending: 1, good: 1 });
  });
  it("nice-to-know questions don't move the verdict", () => {
    expect(tally({ lanes, phases: [ph("a", "phone", "good"), ph("x", "extra", "bad")] }).lean).toBe("looks_fine");
  });
});
