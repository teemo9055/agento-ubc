export type Hex = `0x${string}`;
export type AgentId = "inso" | "trado" | "travo";

export type PhaseStatus = "planned" | "active" | "awaiting_reapproval" | "failed_waiting" | "done" | "failed" | "skipped";
export type TxState = "planned" | "signing" | "pending" | "settled" | "failed";
/** direct: vault.pay · x402: vault-authorized EIP-3009 · subscription: user's own AI, no USDC · exchange: order on an exchange account, not paid from the vault */
export type Rail = "direct" | "x402" | "subscription" | "exchange" | "gateway";

/** Lines that are approved but never paid from the vault. */
export const offVault = (rail: Rail) => rail === "subscription" || rail === "exchange" || rail === "gateway";
/** Lines paid in USDC by the agent (vault x402, or Circle Gateway nanopayments to marketplace sellers). */
export const paidInUsdc = (rail: Rail) => rail === "x402" || rail === "direct" || rail === "gateway";

export type FailureCode =
  | "seller_402_timeout"
  | "payment_rejected"
  | "settle_fails"
  | "insufficient_balance"
  | "policy_block"
  | "price_increase"
  | "model_error"
  | "exchange_rejected"
  | "approval_timeout"
  | "unknown";

export type FailureAction = "retry" | "skip" | "edit" | "cancel" | "topup";

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
  /** How it was paid when not a direct onchain transaction, e.g. a batched Gateway nanopayment. */
  via?: string;
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
  seller: "primary";
  /** Older jobs only; analysis always runs in the app now (use MCP for your own AI). */
  analysis?: "builtin" | "ide";
}

export type RunStatus = "exploring" | "draft" | "funding" | "running" | "done" | "cancelled";

/** A free lookup the agent made while exploring. */
export interface ToolCall {
  /** The source was down (not a bad question): worth trying again. */
  down?: boolean;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  ok: boolean;
}

export interface ChatMsg {
  id: string;
  role: "user" | "agent";
  text: string;
  at: string;
  tools?: ToolCall[];
  /** Figures in the reply that couldn't be matched to looked-up data; shown with a warning. */
  unverified?: string[];
  /** Compact notes from the lookups (symbols, prices), so later turns remember them. */
  facts?: string;
  proposal?: Proposal;
  /** The agent needs one thing from the user before it can go on: tappable answers to its question. */
  options?: string[];
  /** Quick replies the user can tap. */
  suggestions?: string[];
  /** A plan of several moves, possibly for different agents, run one after another. */
  plan?: Plan;
  /** For an open-ended problem: what the agent understood, what drives it, and how much of each part it can take on. */
  brief?: Brief;
}

export interface Brief {
  /** The user's problem in one sentence. */
  understood: string;
  drivers: {
    what: string;
    /** now/partly: a step of the plan handles it. mainnet: a service exists but takes mainnet. no: nothing here helps. */
    help: "now" | "partly" | "mainnet" | "no";
    /** What would be done about it, or why not. */
    how: string;
    /** The plan step that handles it ("s2"), when there is one. */
    step?: string;
  }[];
  /** What stays uncovered even if everything proposed is done. */
  leftOpen?: string;
}

/** Paid research the move depends on. Tools come from the catalog; code prices them. */
export interface ResearchStep {
  id: string;
  tool: string;
  args: Record<string, string>;
  label: string;
  why: string;
}

export type MoveAction =
  | {
      kind: "prediction_order";
      eventTicker: string;
      symbol: string;
      label: string;
      /** The question the contract belongs to, e.g. "BTC price on November 30"; read from the exchange. */
      event?: string;
      side: "yes" | "no";
      /** buy (default) opens or adds to a position; sell closes contracts you hold, at maxPrice or better (i.e. at least maxPrice). */
      trade?: "buy" | "sell";
      /** limit: rests on the book and fills at maxPrice or better. stop-limit: goes on the book once the price rises to stopPrice. */
      orderType: "limit" | "stop-limit";
      maxPrice: number;
      stopPrice?: number;
      quantity: number;
      /** Set when the order is for a combination: one contract that pays only if every leg resolves as named. */
      combo?: Combo;
    }
  | { kind: "spot_order"; symbol: string; side: "buy" | "sell"; limitPrice: number; amountUsd: number }
  | { kind: "itinerary"; stops: string[]; hoursPerDay: number };

export interface ComboLeg {
  eventTicker: string;
  symbol: string;
  /** The contract, e.g. "$65,000 or above". */
  label: string;
  /** The question it belongs to, e.g. "BTC price today at 5pm". */
  event: string;
  /** The outcome this leg needs. */
  side: "yes" | "no";
  /** What that outcome costs on its own right now (0-1), when someone is selling. */
  price: number | null;
  contractId?: string;
  expiry?: string;
}

export interface Combo {
  legs: ComboLeg[];
  /** The legs' prices multiplied: what the combination is worth if the legs don't move together. */
  fair: number | null;
}

/** Condition checked on fresh data right before acting. */
export interface MoveCondition {
  /** What is compared: the contract's YES price, or a spot price. */
  metric: "yes_price" | "no_price" | "spot_price" | "oracle_price";
  symbol: string;
  op: "<=" | ">=";
  value: number;
}

export interface Proposal {
  id: string;
  title: string;
  why: string;
  research: ResearchStep[];
  action?: MoveAction;
  condition?: MoveCondition;
  /** The plain question shown to the user, e.g. "Buy 10 YES at 55¢ or less if odds are still under 60%?" */
  ask: string;
  /** Where the order would go, fixed when the move is proposed. */
  venue: Venue;
  /** The most the user said they'd spend on the order, enforced. */
  budgetUsd?: number;
  /** The book when the move was proposed, so outcomes can teach later moves. */
  market?: { ask: number | null; bid: number | null; closesAt?: string };
  /** What this version changed compared with the move before it, e.g. "+ Odds history", "$5 → $10". */
  changes?: string[];
  /** More checks that must hold too, read at the same moment as `condition`. The move goes ahead only if all pass. */
  also?: MoveCondition[];
  /** The order is insurance against something: what it protects, and the numbers, computed by code. */
  hedge?: { protects: string; lossUsd: number; cost: number; payout: number; /** How much of the loss the payout covers after its own cost. */ covered: number };
  /** Changes code made to the model's move (rounding, budget), shown to the user. */
  adjustments?: string[];
}

/** gemini: real money · gemini-sandbox: Gemini's test exchange · paper: simulation, nothing is sent. */
export type Venue = "gemini-sandbox" | "gemini" | "paper";

export interface OrderResult {
  venue: Venue;
  /** open: resting on the exchange · simulated: paper only, never sent */
  status: "open" | "filled" | "cancelled" | "skipped" | "rejected" | "simulated";
  detail: string;
  orderId?: string;
  notional?: number;
  symbol?: string;
  quantity?: number;
  filledQuantity?: number;
  avgPrice?: number;
  updatedAt?: string;
  /** Fingerprint of the order written to Arc: digest of the order record and the transaction. */
  anchor?: { digest: string; tx: string };
}

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
  /** Explore conversation, before and after the move is chosen. */
  chat?: ChatMsg[];
  /** The plan started from this chat, with each step's live status. */
  plan?: Plan;
  /** What the steps before this one in the plan reported, passed along by their agents. */
  handoff?: string;
  /** Kept by the user to find and run again. */
  saved?: boolean;
  /** This job repeats that earlier job. */
  repeatOf?: string;
  /** This job is one step of a plan started in that job's chat. */
  parentId?: string;
  stepId?: string;
  /** True while the agent is answering in chat. */
  thinking?: string;
  /** The move this work order executes. */
  proposal?: Proposal;
  order?: OrderResult;
  /** How the position ended once its market resolved. */
  settlement?: Settlement;
}

export interface Settlement {
  /** How the contract resolved (for a combination: yes only if every leg came in). */
  resolved: "yes" | "no";
  won: boolean;
  quantity: number;
  /** Dollars paid out: $1 a contract when it won, nothing otherwise. */
  paid: number;
  cost: number;
  /** A practice order: these are the amounts it would have been. */
  practice: boolean;
  at: string;
  legs?: { label: string; side: "yes" | "no"; resolved?: "yes" | "no" }[];
}

/** One step of a plan: a full move for the agent that does it. */
export interface PlanStep {
  id: string;
  agent: AgentId;
  proposal: Proposal;
  /** The steps this one waits for (their ids). Empty: it can start right away, alongside others. */
  after: string[];
  /** done: start once the steps it waits for finish. filled: only once their orders have filled. */
  gate: "done" | "filled";
  /** What the host agent asked this step's agent to do. */
  brief?: string;
  /** Its budget is what the sell it waits for brought in, set when it starts. */
  useProceeds?: boolean;
  /** The job running this step, once started. */
  runId?: string;
  status: "waiting" | "running" | "blocked" | "done" | "failed" | "skipped";
  note?: string;
  /** Once it has started: where each of its sub-tasks stands, by the id of the job's phase. */
  parts?: Record<string, { state: "planned" | "active" | "done" | "failed" | "skipped"; note?: string }>;
}

export interface Plan {
  id: string;
  title: string;
  why: string;
  steps: PlanStep[];
  /** Parts of the request no agent can do here, said plainly. */
  unavailable: { what: string; why: string }[];
  status: "proposed" | "running" | "done" | "stopped";
}
