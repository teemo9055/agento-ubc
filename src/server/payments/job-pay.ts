import type { Hex } from "viem";
import type { Net } from "@/lib/networks";
import { chainOf, send, usdcAbi } from "../chain";

/**
 * A job's lookups are paid by the app's agent wallet through Circle Gateway: batched nanopayments
 * that reach Arc whenever Circle settles a batch. So that every job still moves the person's own
 * money on Arc, visibly and at once, the person's wallet pays the job's lookup total to the agent
 * wallet when they approve, and whatever wasn't spent goes back when the job ends.
 */
export async function payInForJob(net: Net, amount: bigint): Promise<{ txHash: Hex } | null> {
  const c = chainOf(net);
  if (amount <= 0n || !c.addresses.client || !c.addresses.agent) return null;
  const tx = await send("client", { address: c.usdc, abi: usdcAbi, functionName: "transfer", args: [c.addresses.agent, amount] }, net);
  return { txHash: tx.hash };
}

/** Sends the unspent part back from the agent wallet to the person's wallet. */
export async function payBackForJob(net: Net, amount: bigint): Promise<{ txHash: Hex } | null> {
  const c = chainOf(net);
  if (amount <= 0n || !c.addresses.client || !c.addresses.agent) return null;
  const tx = await send("agent", { address: c.usdc, abi: usdcAbi, functionName: "transfer", args: [c.addresses.client, amount] }, net);
  return { txHash: tx.hash };
}
