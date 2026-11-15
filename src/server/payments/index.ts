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
}

export interface PayResult {
  amount: bigint;
  txHash?: Hex;
  fee?: string;
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
  close(run: Run): Promise<{ refunded: bigint; txHash?: Hex }>;
}

export const adapterFor = (run: Run): PaymentAdapter => (run.mode === "live" ? arcAdapter : demoAdapter);
