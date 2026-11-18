import type { Hex } from "viem";
import { addresses, send, USDC, usdcAbi } from "../chain";
import { PRACTICE_TX, recordSale } from "../sales";
import { SELLERS } from "../sellers";
import { createItem, depositPaid, HALL_DEPOSIT, type HallInput, type HallItem } from "./hall";

/**
 * A person sends something to Town Hall from the app. In practice mode a clearly labelled practice
 * deposit is recorded and no money moves; live, the app's client wallet pays 1 USDC to Agento's
 * seller on Arc. Either way the deposit is a recorded sale, so a refund goes through the same path
 * as every other refund in the app.
 */
export async function sendFromApp(input: HallInput, opts: { live: boolean; pay?: () => Promise<string>; by?: HallItem["by"] }): Promise<{ ok: true; item: HallItem } | { ok: false; status: number; reason: string }> {
  const item = createItem(input, opts.by ?? "person", opts.live ? "live" : "practice");
  const params = { kind: item.kind, text: item.text };
  if (!opts.live) {
    const sale = recordSale({ product: "hall.request", payer: "practice", amount: HALL_DEPOSIT.toString(), tx: `${PRACTICE_TX}:${item.id}`, own: true, params });
    return { ok: true, item: depositPaid(item.id, sale) };
  }
  try {
    const tx = await (opts.pay ?? payDeposit)();
    const sale = recordSale({ product: "hall.request", payer: addresses.client ?? "client", amount: HALL_DEPOSIT.toString(), tx, own: true, params });
    return { ok: true, item: depositPaid(item.id, sale) };
  } catch (e) {
    // The item stays unpaid, so it is never shown or routed.
    return { ok: false, status: 502, reason: `The $1 deposit couldn't be sent: ${(e as Error).message.slice(0, 120)}` };
  }
}

/** 1 USDC from the app's client wallet to the seller wallet on Arc: the same wallet a refund is paid back from. */
async function payDeposit(): Promise<string> {
  return (await send("client", { address: USDC, abi: usdcAbi, functionName: "transfer", args: [(addresses.seller ?? SELLERS.primary.address) as Hex, HALL_DEPOSIT] })).hash;
}
