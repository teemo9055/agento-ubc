import type { Plan, AiStats, ChatMsg, OrderResult, CostLine, Decision, Deliverable, Failure, FailureAction, Hex, Payment, Phase, ReapprovalRequest, Report, Run, Settlement } from "./types";

export type RunEvent =
  | { type: "workorder.updated"; run: Run }
  | { type: "run.funding" }
  | { type: "run.resumed"; at: string }
  | { type: "chat.message"; message: ChatMsg }
  | { type: "chat.thinking"; note?: string }
  | { type: "order.updated"; order: OrderResult }
  | { type: "order.settled"; settlement: Settlement }
  | { type: "plan.updated"; plan: Plan }
  | { type: "run.saved"; saved: boolean }
  | { type: "run.approved"; planHash: Hex; vault?: Hex; fundingTx?: Hex; at: string }
  | { type: "phase.started"; phaseId: string; at?: string }
  | { type: "phase.progress"; phaseId: string; progress: number; note?: string }
  | { type: "phase.done"; phaseId: string; note?: string; at?: string }
  | { type: "phase.skipped"; phaseId: string; note?: string; at?: string }
  /** What a step found, what flowed into it, whether its sources agreed: drawn on the graph. */
  | { type: "phase.updated"; phaseId: string; patch: Pick<Phase, "finding" | "inputs" | "conflict"> }
  /** The live tally of findings, recomputed by code after each finished step. */
  | { type: "run.tallied"; verdict: NonNullable<Run["verdict"]> }
  | { type: "payment.updated"; phaseId: string; payment: Payment }
  | { type: "line.updated"; line: CostLine }
  | { type: "data.received"; key: string; product: string; data: unknown; phaseId?: string }
  | { type: "ai.used"; purpose: string; usage: Omit<AiStats, "calls"> }
  | { type: "reapproval.requested"; request: ReapprovalRequest }
  | { type: "reapproval.decided"; requestId: string; outcome: "approved" | "denied" | "timed_out" }
  | { type: "failure.raised"; failure: Failure }
  | { type: "failure.resolved"; failureId: string; action: FailureAction }
  | { type: "decision.logged"; decision: Decision }
  | { type: "run.done"; deliverable: Deliverable; refunded: string; refundTx?: Hex; at: string; report?: Report }
  | { type: "run.cancelled"; refunded: string; refundTx?: Hex; at: string };

export type SeqEvent = RunEvent & { seq: number };
