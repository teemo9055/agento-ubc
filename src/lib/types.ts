export type Hex = `0x${string}`;
export type AgentId = "inso" | "trado" | "travo";

export type PhaseStatus = "planned" | "active" | "awaiting_reapproval" | "failed_waiting" | "done" | "failed" | "skipped";
export type TxState = "planned" | "signing" | "pending" | "settled" | "failed";
/** direct: vault.pay · x402: vault-authorized EIP-3009 · subscription: user's own AI, no USDC */
export type Rail = "direct" | "x402" | "subscription";

export type FailureCode =
  | "seller_402_timeout"
  | "payment_rejected"
  | "settle_fails"
  | "insufficient_balance"
  | "policy_block"
  | "price_increase"
  | "model_error"
  | "approval_timeout"
  | "unknown";

export type FailureAction = "retry" | "skip" | "switch" | "edit" | "cancel" | "topup";

export interface Card {
  kind: "deliverable" | "risk" | "method" | "price";
  title: string;
  points: string[];
}

/** One approved spend. Amounts are USDC base units (6 decimals) as decimal strings. */
export interface CostLine {
  id: string;
  index: number; // vault line index
  phaseId: string;
  purpose: string;
  service: string;
  payeeName: string;
  payee: Hex;
  rail: Rail;
  approved: string;
  actual: string;
  bigSpend: boolean;
  calls?: { max: number; unitPrice: string };
}

export interface Payment {
  id: string;
  lineId: string;
  txState: TxState;
  amount?: string;
  txHash?: Hex;
  networkFee?: string; // 18-decimal native units
  at?: string;
}

export interface Phase {
  id: string;
  label: string;
  sub: string;
  status: PhaseStatus;
  dependsOn: string[];
  optional: boolean;
  progress?: number;
  note?: string;
  lineId?: string;
  payments: Payment[];
  alternatives?: { payeeName: string; payee: Hex; service: string; price: string }[];
  error?: { code: FailureCode; message: string };
}

export interface Decision {
  id: string;
  kind: "plan_approval" | "reapproval" | "failure" | "card_edit";
  phaseId?: string;
  what: string;
  why: string;
  amount?: string;
  previousAmount?: string;
  payee?: string;
  outcome: "approved" | "denied" | "edited" | "timed_out" | "retried" | "skipped" | "switched" | "cancelled" | "topped_up" | "rejected";
  by: "user" | "system";
  at: string;
  tx?: Hex;
}

export interface ReapprovalRequest {
  id: string;
  phaseId: string;
  lineId: string;
  reason: string;
  from: { amount: string; payeeName: string; payee: Hex };
  to: { amount: string; payeeName: string; payee: Hex; service: string };
  budgetLeft: string;
  minAmount: string;
  expiresAt: string;
}

export interface Failure {
  id: string;
  phaseId: string;
  code: FailureCode;
  message: string;
  charged: string;
  notCharged: string;
  options: FailureAction[];
}

export interface Deliverable {
  summary: string;
  method: string;
  data?: unknown;
  contextPack?: { prompt: string; data: unknown };
  notes?: string[];
}

export interface AiStats {
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

export interface Method {
  seller: "primary" | "mirror";
  analysis: "builtin" | "ide";
}

export type RunStatus = "draft" | "funding" | "running" | "done" | "cancelled";

export interface Run {
  id: string;
  agent: AgentId;
  task: string;
  mode: "demo" | "live";
  faults: FailureCode[];
  status: RunStatus;
  cards: Card[];
  lines: CostLine[];
  phases: Phase[];
  decisions: Decision[];
  threshold: string;
  cap: string;
  planHash?: Hex;
  vault?: Hex;
  fundingTx?: Hex;
  refundTx?: Hex;
  refunded?: string;
  client: Hex;
  agentWallet: Hex;
  pendingReapprovals: ReapprovalRequest[];
  pendingFailures: Failure[];
  deliverable?: Deliverable;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  editNote?: { ok: boolean; message: string; alternatives?: string[] };
  feed?: Record<string, { product: string; data: unknown }>;
  method: Method;
  planner: "ai" | "rules";
  /** Who signs approvals: the app's server wallet, or the user's own passkey wallet. */
  payer: "server" | "passkey";
  /** True while the plan is being drafted in the background. */
  planning?: boolean;
  ai?: AiStats;
  estFees: string; // 18-decimal native USDC
}
