import type { AgentId, Card, CostLine, Deliverable, OrderResult, Phase } from "@/lib/types";

export type LineDraft = Omit<CostLine, "index" | "actual" | "bigSpend">;
export type PhaseDraft = Omit<Phase, "status" | "payments">;

export interface PlanDraft {
  cards: Card[];
  lines: LineDraft[];
  phases: PhaseDraft[];
}

export interface EditResult {
  ok: boolean;
  message: string;
  options?: Record<string, unknown>;
  alternatives?: string[];
}

export interface AgentCtx {
  task: string;
  options: Record<string, unknown>;
  /** Shared scratch space between phases. Survives retries. */
  memory: Record<string, unknown>;
  progress(p: number, note?: string): void;
  /** Pay-per-request purchase through x402. Idempotent per key, so retries never pay twice. */
  buy<T>(lineId: string, product: string, params: Record<string, string>, key: string): Promise<T>;
  /** Returns true once if this fault switch is on for the run. */
  fault(code: "model_error" | "policy_block"): boolean;
  /** Buys from an outside marketplace seller with a Gateway nanopayment, through the same spend policy. */
  buyMarketplace?<T>(lineId: string, key: string, product: string, fetcher: () => Promise<T & { paid: { amountUsdc: number; payTo: string; via: string } }>): Promise<T>;
  /** Reports the exchange order placed for this move. */
  order?(o: OrderResult): void;
}

export interface AgentDef {
  id: AgentId;
  name: string;
  tagline: string;
  examples: string[];
  defaults: Record<string, unknown>;
  /** Phase where payment faults are injected. */
  faultPhase: string;
  plan(task: string, options: Record<string, unknown>): Promise<PlanDraft>;
  /** Change the agreed move by a request about one card, or about one step of the graph when `step` is a phase id. */
  edit(card: Card["kind"], prompt: string, options: Record<string, unknown>, step?: string): EditResult;
  runPhase(phaseId: string, ctx: AgentCtx): Promise<void>;
  deliver(ctx: AgentCtx): Deliverable;
}

export class PhaseFailure extends Error {
  constructor(
    public code: "model_error" | "policy_block" | "approval_timeout" | "exchange_rejected" | "unknown",
    message: string,
  ) {
    super(message);
  }
}
