import type { Hex } from "viem";
import type { CostLine, Run, TxState } from "@/lib/types";
import type { PaymentRequirements } from "../x402";
import { demoAdapter } from "./demo";
import { arcAdapter } from "./arc";

export interface X402Request {
  product: string;
  params: Record<string, string>;
  seller: "primary";
  fault?: string;
  /** The network the job's money is on; the seller's quote for that network is used. */
  net?: import("@/lib/networks").Net;
}

export interface PayResult {
  amount: bigint;
  txHash?: Hex;
  fee?: string;
}

/** A refund claim for an answer that failed the delivery check. */
export interface RefundClaim {
  product: string;
  amount: bigint;
  txHash?: Hex;
  answer: unknown;
}

export class PaymentError extends Error {
  constructor(
    public code: "seller_402_timeout" | "payment_rejected" | "settle_fails" | "insufficient_balance",
    message: string,
    public charged = 0n,
  ) {
    super(message);
  }
}

export interface PaymentAdapter {
  /** After a restart: what the vault held and what was already spent, for adapters that keep it in memory. */
  restore?(run: Run, funded: bigint, spent: bigint): void;
  live: boolean;
  /** Fund the vault with the approved plan. */
  open(run: Run, planHash: Hex): Promise<{ vault?: Hex; fundingTx?: Hex }>;
  /** Payer re-approval: change a line onchain. */
  setLine(run: Run, line: CostLine, planHash: Hex): Promise<Hex | undefined>;
  topUp(run: Run, amount: bigint): Promise<Hex | undefined>;
  /** Ask the seller for its price. Returns the 402 requirements. */
  quote(req: X402Request): Promise<PaymentRequirements>;
  /** Pay the quoted price from the vault and fetch the resource. */
  payX402(
    run: Run,
    line: CostLine,
    req: X402Request,
    quote: PaymentRequirements,
    onState: (s: TxState, p?: Partial<PayResult>) => void,
  ): Promise<{ data: unknown; result: PayResult }>;
  payDirect(run: Run, line: CostLine, amount: bigint, ref: Hex, onState: (s: TxState) => void): Promise<PayResult>;
  /** Ask the seller to send the price back for an answer that failed its published checks. Null when it refused. */
  refund(run: Run, claim: RefundClaim): Promise<{ amount: bigint; txHash?: Hex } | { refused: string }>;
  close(run: Run): Promise<{ refunded: bigint; txHash?: Hex }>;
}

export const adapterFor = (run: Run): PaymentAdapter => (run.mode === "live" ? arcAdapter : demoAdapter);
