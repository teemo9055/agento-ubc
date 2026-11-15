import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { randomUUID } from "node:crypto";
import type { Hex } from "viem";

/** Circle developer-controlled wallets (MPC keys held by Circle; app holds the entity secret). */
export const circleWallets = {
  agent: process.env.CIRCLE_AGENT_WALLET_ID ? { id: process.env.CIRCLE_AGENT_WALLET_ID, address: process.env.CIRCLE_AGENT_ADDRESS as Hex } : undefined,
  seller: process.env.CIRCLE_SELLER_WALLET_ID ? { id: process.env.CIRCLE_SELLER_WALLET_ID, address: process.env.CIRCLE_SELLER_ADDRESS as Hex } : undefined,
};

let client: ReturnType<typeof initiateDeveloperControlledWalletsClient> | null = null;
function circle() {
  if (!process.env.CIRCLE_ENTITY_SECRET) throw new Error("CIRCLE_ENTITY_SECRET missing");
  // The API key may be injected by an outbound proxy; any well-formed placeholder works then.
  client ??= initiateDeveloperControlledWalletsClient({
    apiKey: process.env.CIRCLE_API_KEY ?? "TEST_API_KEY:proxy00000000000000000000000000:injected0000000000000000000000",
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
  });
  return client;
}

/** Executes a contract call from a Circle wallet and waits until it is onchain. */
export async function circleExecute(walletId: string, contractAddress: Hex, callData: Hex): Promise<Hex> {
  const c = circle();
  const created = await c.createContractExecutionTransaction({
    walletId,
    contractAddress,
    callData,
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    idempotencyKey: randomUUID(),
  });
  const id = created.data?.id;
  if (!id) throw new Error("Circle did not return a transaction id");
  const res = await c.getTransaction({ id, waitForState: "CONFIRMED", pollingInterval: 700, signal: AbortSignal.timeout(90_000) });
  const hash = res.data?.transaction?.txHash as Hex | undefined;
  if (!hash) throw new Error(`Circle transaction ${id} has no hash`);
  return hash;
}

/** Signs EIP-712 typed data with a Circle wallet (EOA). Used for Gateway nanopayment authorizations. */
export async function circleSignTypedData(walletId: string, typedData: unknown): Promise<Hex> {
  const data = JSON.stringify(typedData, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  const r = await circle().signTypedData({ walletId, data });
  const sig = r.data?.signature;
  if (!sig) throw new Error("Circle returned no signature");
  return (sig.startsWith("0x") ? sig : `0x${sig}`) as Hex;
}
