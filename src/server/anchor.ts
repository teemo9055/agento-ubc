import type { OrderResult, Run } from "@/lib/types";
import { orderDigest } from "@/lib/order-record";
export { orderDigest, orderRecord } from "@/lib/order-record";
import { circleExecute, circleWallets } from "./circle";

/**
 * Writes a fingerprint of each exchange order to Arc, so the record of what the agent placed
 * can't be rewritten later, even for moves that open no vault. The transaction carries only the
 * hash; anyone holding the job's receipt can recompute it and compare.
 */

export const canAnchor = (run: Run, o: OrderResult) =>
  process.env.ANCHOR_ORDERS !== "false" && run.mode === "live" && Boolean(circleWallets.agent) && o.venue !== "paper" && Boolean(o.orderId) && !o.anchor;

/** A zero-value transaction from the agent wallet to itself with the digest as data. */
export async function anchorOrder(run: Run, o: OrderResult): Promise<NonNullable<OrderResult["anchor"]>> {
  const w = circleWallets.agent!;
  const digest = orderDigest(run, o);
  const tx = await circleExecute(w.id, w.address, digest);
  return { digest, tx };
}
