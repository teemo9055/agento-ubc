import type { SeqEvent } from "./events";
import type { Phase, Run } from "./types";

const mapPhase = (run: Run, id: string, f: (p: Phase) => Phase): Run => ({
  ...run,
  phases: run.phases.map((p) => (p.id === id ? f(p) : p)),
});

/** Pure: folds orchestrator events into run state. The client never advances state on its own. */
export function reduce(run: Run | null, e: SeqEvent): Run | null {
  if (e.type === "workorder.updated") return e.run;
  if (!run) return run;

  switch (e.type) {
    case "chat.message":
      return { ...run, chat: [...(run.chat ?? []), e.message], thinking: e.message.role === "user" ? run.thinking : undefined };
    case "chat.thinking":
      return { ...run, thinking: e.note };
    case "order.updated":
      return { ...run, order: e.order };
    case "order.settled":
      return { ...run, settlement: e.settlement };
    case "run.saved":
      return { ...run, saved: e.saved };
    case "plan.updated":
      return { ...run, plan: e.plan };
    case "run.resumed":
      // After a restart: steps that were cut off run again; questions that were open are asked again.
      return {
        ...run,
        pendingFailures: [],
        pendingReapprovals: [],
        phases: run.phases.map((p) => (["active", "awaiting_reapproval", "failed_waiting"].includes(p.status) ? { ...p, status: "planned", progress: 0, error: undefined } : p)),
      };
    case "run.funding":
      return { ...run, status: "funding" };
    case "run.approved":
      return { ...run, status: "running", planHash: e.planHash, vault: e.vault, fundingTx: e.fundingTx, startedAt: e.at };
    case "phase.started":
      return mapPhase(run, e.phaseId, (p) => ({ ...p, status: "active", error: undefined, progress: 0 }));
    case "phase.progress":
      return mapPhase(run, e.phaseId, (p) => ({ ...p, progress: Math.max(p.progress ?? 0, e.progress), note: e.note ?? p.note }));
    case "phase.done":
      return mapPhase(run, e.phaseId, (p) => ({ ...p, status: "done", progress: 1, note: e.note ?? p.note }));
    case "phase.skipped":
      return mapPhase(run, e.phaseId, (p) => ({ ...p, status: "skipped" }));
    case "payment.updated":
      return mapPhase(run, e.phaseId, (p) => {
        const i = p.payments.findIndex((x) => x.id === e.payment.id);
        const payments = i < 0 ? [...p.payments, e.payment] : p.payments.map((x, j) => (j === i ? { ...x, ...e.payment } : x));
        return { ...p, payments };
      });
    case "line.updated": {
      const exists = run.lines.some((l) => l.id === e.line.id);
      return { ...run, lines: exists ? run.lines.map((l) => (l.id === e.line.id ? e.line : l)) : [...run.lines, e.line] };
    }
    case "ai.used": {
      const prev = run.ai ?? { model: e.usage.model, calls: 0, promptTokens: 0, completionTokens: 0 };
      return {
        ...run,
        ai: {
          model: e.usage.model,
          calls: prev.calls + 1,
          promptTokens: prev.promptTokens + e.usage.promptTokens,
          completionTokens: prev.completionTokens + e.usage.completionTokens,
        },
      };
    }
    case "data.received":
      return { ...run, feed: { ...run.feed, [e.key]: { product: e.product, data: e.data } } };
    case "reapproval.requested":
      return {
        ...mapPhase(run, e.request.phaseId, (p) => ({ ...p, status: "awaiting_reapproval" })),
        pendingReapprovals: [...run.pendingReapprovals, e.request],
      };
    case "reapproval.decided": {
      const req = run.pendingReapprovals.find((r) => r.id === e.requestId);
      const next = { ...run, pendingReapprovals: run.pendingReapprovals.filter((r) => r.id !== e.requestId) };
      return req ? mapPhase(next, req.phaseId, (p) => (p.status === "awaiting_reapproval" ? { ...p, status: "active" } : p)) : next;
    }
    case "failure.raised":
      return {
        ...mapPhase(run, e.failure.phaseId, (p) => ({
          ...p,
          status: "failed_waiting",
          error: { code: e.failure.code, message: e.failure.message },
        })),
        pendingFailures: [...run.pendingFailures, e.failure],
      };
    case "failure.resolved":
      return { ...run, pendingFailures: run.pendingFailures.filter((f) => f.id !== e.failureId) };
    case "decision.logged":
      return { ...run, decisions: [...run.decisions, e.decision] };
    case "run.done":
      return { ...run, status: "done", deliverable: e.deliverable, refunded: e.refunded, refundTx: e.refundTx, finishedAt: e.at };
    case "run.cancelled":
      return {
        ...run,
        status: "cancelled",
        refunded: e.refunded,
        refundTx: e.refundTx,
        finishedAt: e.at,
        pendingFailures: [],
        pendingReapprovals: [],
        phases: run.phases.map((p) =>
          p.status === "done" || p.status === "skipped" ? p : { ...p, status: p.status === "planned" ? "skipped" : "failed" },
        ),
      };
  }
}

export const reduceAll = (events: SeqEvent[]) => events.reduce<Run | null>(reduce, null);
