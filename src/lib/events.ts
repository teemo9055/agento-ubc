import type { AiStats, CostLine, Decision, Deliverable, Failure, FailureAction, Hex, Payment, ReapprovalRequest, Run } from "./types";

export type RunEvent =
  | { type: "workorder.updated"; run: Run }
  | { type: "run.funding" }
  | { type: "run.approved"; planHash: Hex; vault?: Hex; fundingTx?: Hex; at: string }
  | { type: "phase.started"; phaseId: string }
  | { type: "phase.progress"; phaseId: string; progress: number; note?: string }
  | { type: "phase.done"; phaseId: string; note?: string }
  | { type: "phase.skipped"; phaseId: string }
  | { type: "payment.updated"; phaseId: string; payment: Payment }
  | { type: "line.updated"; line: CostLine }
  | { type: "data.received"; key: string; product: string; data: unknown }
  | { type: "ai.used"; purpose: string; usage: Omit<AiStats, "calls"> }
  | { type: "reapproval.requested"; request: ReapprovalRequest }
  | { type: "reapproval.decided"; requestId: string; outcome: "approved" | "denied" | "timed_out" }
  | { type: "failure.raised"; failure: Failure }
  | { type: "failure.resolved"; failureId: string; action: FailureAction }
  | { type: "decision.logged"; decision: Decision }
  | { type: "run.done"; deliverable: Deliverable; refunded: string; refundTx?: Hex; at: string }
  | { type: "run.cancelled"; refunded: string; refundTx?: Hex; at: string };

export type SeqEvent = RunEvent & { seq: number };
