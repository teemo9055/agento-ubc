import type { Hex } from "viem";
import { addresses, send, USDC, usdcAbi } from "./chain";
import { answerHash, checkDelivery, type DeliveryVerdict } from "./delivery";
import { finishRefund, findSale, isPractice, lockRefund, type Sale } from "./sales";
import { PRODUCTS, REFUND_WINDOW_MIN } from "./x402";

export type ClaimResult =
  | { ok: true; amount: string; refundTx?: string; verdict: Extract<DeliveryVerdict, { ok: false }> }
  | { ok: false; status: number; reason: string };

/**
 * A buyer's refund claim against this app's own x402 seller. The seller decides by evidence, never
 * by opinion: the answer must be the one it sent (same fingerprint) and must fail one of the
 * published checks. Then the full price goes back to the address that paid, once.
 */
export async function claimRefund(c: { tx: string; payer: string; answer: unknown }, opts: { now?: number; pay?: (to: Hex, amount: bigint) => Promise<string | undefined> } = {}): Promise<ClaimResult> {
  const sale = findSale({ tx: c.tx });
  if (!sale) return { ok: false, status: 404, reason: "No sale with that transaction" };
  if (sale.payer.toLowerCase() !== c.payer.toLowerCase()) return { ok: false, status: 403, reason: "Only the address that paid can claim" };
  if (sale.refunded) return { ok: false, status: 409, reason: "This sale was already refunded" };
  const age = ((opts.now ?? Date.now()) - Date.parse(sale.at)) / 60_000;
  if (age > REFUND_WINDOW_MIN) return { ok: false, status: 410, reason: `Claims close ${REFUND_WINDOW_MIN} minutes after the sale` };
  if (!sale.answerHash || answerHash(c.answer) !== sale.answerHash) return { ok: false, status: 422, reason: "That isn't the answer that was sent for this sale" };
  const product = PRODUCTS[sale.product];
  const verdict = checkDelivery(c.answer, product?.promise, sale.params ?? {});
  if (verdict.ok) return { ok: false, status: 422, reason: "The answer passes every published check, so it stays paid" };
  if (!lockRefund(sale.id)) return { ok: false, status: 409, reason: "This sale was already refunded" };
  try {
    const refundTx = await (opts.pay ?? payBack)(sale.payer as Hex, BigInt(sale.amount));
    finishRefund(sale.id, { tx: refundTx });
    return { ok: true, amount: sale.amount, refundTx, verdict };
  } catch (e) {
    finishRefund(sale.id, null);
    return { ok: false, status: 502, reason: `Refund couldn't be sent: ${(e as Error).message.slice(0, 120)}` };
  }
}

export type AdminRefund = { ok: true; amount: string; refundTx?: string; practice: boolean; reason: string } | { ok: false; status: number; reason: string };

/**
 * A refund decided by a person (e.g. a Town Hall deposit that wasn't spam) rather than claimed by
 * evidence: no delivery check, but the same once-only lock and the same transfer from the seller's
 * wallet back to the payer. A practice sale is marked refunded with no transfer.
 */
export async function refundSale(saleId: string, reason: string, opts: { pay?: (to: Hex, amount: bigint) => Promise<string | undefined> } = {}): Promise<AdminRefund> {
  const sale = findSale({ id: saleId });
  if (!sale) return { ok: false, status: 404, reason: "No sale with that id" };
  if (sale.refunded || !lockRefund(sale.id)) return { ok: false, status: 409, reason: "This sale was already refunded" };
  if (isPractice(sale)) {
    finishRefund(sale.id, {});
    return { ok: true, amount: sale.amount, practice: true, reason };
  }
  try {
    const refundTx = await (opts.pay ?? payBack)(sale.payer as Hex, BigInt(sale.amount));
    finishRefund(sale.id, { tx: refundTx });
    return { ok: true, amount: sale.amount, refundTx, practice: false, reason };
  } catch (e) {
    finishRefund(sale.id, null);
    return { ok: false, status: 502, reason: `Refund couldn't be sent: ${(e as Error).message.slice(0, 120)}` };
  }
}

/** Sends USDC from the seller's wallet back to the payer on Arc. */
async function payBack(to: Hex, amount: bigint): Promise<string | undefined> {
  if (!addresses.seller) throw new Error("seller wallet missing");
  return (await send("seller", { address: USDC, abi: usdcAbi, functionName: "transfer", args: [to, amount] })).hash;
}

/** The answer a payer already paid for, sent again for free (for when it was lost on the way). */
export function redeliver(payer: string, nonce: string): { ok: true; sale: Sale; data: unknown } | { ok: false; status: number; reason: string } {
  const sale = findSale({ nonce });
  if (!sale || sale.payer.toLowerCase() !== payer.toLowerCase()) return { ok: false, status: 404, reason: "No sale for that payer and authorization" };
  if (sale.answer == null) return { ok: false, status: 404, reason: "The answer wasn't kept" };
  return { ok: true, sale, data: JSON.parse(sale.answer) as unknown };
}
