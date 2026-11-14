import { describe, expect, it } from "vitest";
import type { RunEvent, SeqEvent } from "./events";
import { reduce, reduceAll } from "./reducer";
import type { Run } from "./types";

const base = {
  id: "r1",
  status: "draft",
  phases: [
    { id: "a", status: "planned", payments: [], dependsOn: [] },
    { id: "b", status: "planned", payments: [], dependsOn: ["a"] },
  ],
  lines: [{ id: "l1", approved: "100", actual: "0" }],
  decisions: [],
  pendingReapprovals: [],
  pendingFailures: [],
} as unknown as Run;

let seq = 0;
const ev = (e: RunEvent) => ({ ...e, seq: seq++ }) as SeqEvent;
const start = () => reduce(null, ev({ type: "workorder.updated", run: base }))!;

describe("reducer", () => {
  it("ignores events before the work order exists", () => {
    expect(reduce(null, ev({ type: "phase.started", phaseId: "a" }))).toBeNull();
  });

  it("moves a phase planned -> active -> done and never rewinds progress", () => {
    let r = start();
    r = reduce(r, ev({ type: "phase.started", phaseId: "a" }))!;
    r = reduce(r, ev({ type: "phase.progress", phaseId: "a", progress: 0.6 }))!;
    r = reduce(r, ev({ type: "phase.progress", phaseId: "a", progress: 0.3 }))!;
    expect(r.phases[0].progress).toBe(0.6);
    r = reduce(r, ev({ type: "phase.done", phaseId: "a" }))!;
    expect(r.phases[0]).toMatchObject({ status: "done", progress: 1 });
  });

  it("upserts payments by id", () => {
    let r = start();
    r = reduce(r, ev({ type: "payment.updated", phaseId: "a", payment: { id: "p1", lineId: "l1", txState: "signing" } }))!;
    r = reduce(r, ev({ type: "payment.updated", phaseId: "a", payment: { id: "p1", lineId: "l1", txState: "settled", txHash: "0xab" } }))!;
    expect(r.phases[0].payments).toEqual([expect.objectContaining({ id: "p1", txState: "settled", txHash: "0xab" })]);
  });

  it("re-approval pauses the step and resumes it when decided", () => {
    let r = start();
    r = reduce(r, ev({ type: "phase.started", phaseId: "a" }))!;
    const request = { id: "q1", phaseId: "a" } as Run["pendingReapprovals"][number];
    r = reduce(r, ev({ type: "reapproval.requested", request }))!;
    expect(r.phases[0].status).toBe("awaiting_reapproval");
    expect(r.pendingReapprovals).toHaveLength(1);
    r = reduce(r, ev({ type: "reapproval.decided", requestId: "q1", outcome: "approved" }))!;
    expect(r.phases[0].status).toBe("active");
    expect(r.pendingReapprovals).toHaveLength(0);
  });

  it("failures queue and clear", () => {
    let r = start();
    const failure = { id: "f1", phaseId: "a", code: "settle_fails", message: "x" } as Run["pendingFailures"][number];
    r = reduce(r, ev({ type: "failure.raised", failure }))!;
    expect(r.phases[0]).toMatchObject({ status: "failed_waiting", error: { code: "settle_fails" } });
    r = reduce(r, ev({ type: "failure.resolved", failureId: "f1", action: "retry" }))!;
    expect(r.pendingFailures).toHaveLength(0);
  });

  it("cancel skips planned steps, fails unfinished ones and clears popups", () => {
    let r = start();
    r = reduce(r, ev({ type: "phase.started", phaseId: "a" }))!;
    r = reduce(r, ev({ type: "run.cancelled", refunded: "50", at: "t" }))!;
    expect(r.status).toBe("cancelled");
    expect(r.phases.map((p) => p.status)).toEqual(["failed", "skipped"]);
    expect(r.refunded).toBe("50");
  });

  it("is deterministic over a full log", () => {
    const log = [
      ev({ type: "workorder.updated", run: base }),
      ev({ type: "run.approved", planHash: "0x1", at: "t" }),
      ev({ type: "line.updated", line: { ...base.lines[0], actual: "40" } }),
      ev({ type: "data.received", key: "k", product: "p", data: [1] }),
    ];
    expect(reduceAll(log)).toEqual(reduceAll(log));
    expect(reduceAll(log)).toMatchObject({ status: "running", lines: [{ actual: "40" }], feed: { k: { product: "p" } } });
  });
});
