import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { USDC, publicClient, usdcAbi } from "@/server/chain";
import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

export const dynamic = "force-dynamic";

/** Small testnet top-up for new passkey wallets: 1 USDC once per address, capped per day. */
const ONCE = 1_000_000n;
const DAILY = BigInt(Math.round(Number(process.env.FAUCET_DAILY_LIMIT_USDC ?? 10) * 1e6));
const g = globalThis as unknown as { __faucet?: { day: string; spent: bigint; given: Set<string> } };

export async function POST(req: NextRequest) {
  const parsed = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad address" }, { status: 400 });
  const key = process.env.FAUCET_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) return NextResponse.json({ error: "Faucet not configured. Use faucet.circle.com (Arc Testnet)." }, { status: 503 });
  const address = parsed.data.address as Hex;
  const day = new Date().toISOString().slice(0, 10);
  const st = (g.__faucet = g.__faucet?.day === day ? g.__faucet : { day, spent: 0n, given: g.__faucet?.given ?? new Set() });
  if (st.given.has(address.toLowerCase())) return NextResponse.json({ error: "Already topped up. Get more at faucet.circle.com." }, { status: 429 });
  if (st.spent + ONCE > DAILY) return NextResponse.json({ error: "Today's faucet budget is used up. Try faucet.circle.com." }, { status: 429 });
  const bal = await publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [address] });
  if (bal >= ONCE) return NextResponse.json({ error: "This wallet already has test USDC." }, { status: 400 });
  st.given.add(address.toLowerCase());
  st.spent += ONCE;
  const w = createWalletClient({ account: privateKeyToAccount(key as Hex), chain: arcTestnet, transport: http(process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network") });
  const hash = await w.writeContract({ address: USDC, abi: [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }], functionName: "transfer", args: [address, ONCE] });
  await publicClient.waitForTransactionReceipt({ hash });
  return NextResponse.json({ ok: true, amount: "1.00", txHash: hash });
}
