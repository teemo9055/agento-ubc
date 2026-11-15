import { keccak256, toHex, type Hex } from "viem";
import type { OrderResult, Run } from "./types";

/** The fields that identify the order, in a fixed order. */
export function orderRecord(run: Pick<Run, "id" | "planHash">, o: OrderResult) {
  return { job: run.id, plan: run.planHash ?? null, venue: o.venue, orderId: o.orderId ?? null, detail: o.detail, symbol: o.symbol ?? null, quantity: o.quantity ?? null };
}

export const orderDigest = (run: Pick<Run, "id" | "planHash">, o: OrderResult): Hex => keccak256(toHex(JSON.stringify(orderRecord(run, o))));

