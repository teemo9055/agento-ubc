import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAddress, parseUnits, type Hex } from "viem";
import { chainOf, liveReady, send, usdcAbi } from "@/server/chain";

export const dynamic = "force-dynamic";

const Body = z.object({ network: z.enum(["testnet", "mainnet"]), to: z.string(), amount: z.string().regex(/^\d+(\.\d{1,6})?$/) });

/** The Agento wallet's address on a network, so the page can show it for deposits. */
export async function GET(req: NextRequest) {
  const net = req.nextUrl.searchParams.get("network") === "mainnet" ? "mainnet" : "testnet";
  const c = chainOf(net);
  return NextResponse.json({ network: net, address: c.addresses.client ?? null });
}

/** Withdraw: USDC from the Agento wallet to an address the person gives. Asked for, and confirmed, by them. */
export async function POST(req: NextRequest) {
  const b = Body.safeParse(await req.json().catch(() => ({})));
  if (!b.success) return NextResponse.json({ error: "Give an amount and an Arc address." }, { status: 400 });
  const { network, to, amount } = b.data;
  if (!isAddress(to)) return NextResponse.json({ error: "That isn't an Arc address." }, { status: 400 });
  if (network === "mainnet" && !liveReady("mainnet")) return NextResponse.json({ error: "Arc mainnet isn't set up on this server." }, { status: 503 });
  const c = chainOf(network);
  if (!c.addresses.client) return NextResponse.json({ error: "This server has no Agento wallet on that network." }, { status: 503 });
  const units = parseUnits(amount, 6);
  if (units <= 0n) return NextResponse.json({ error: "The amount must be more than zero." }, { status: 400 });
  try {
    const tx = await send("client", { address: c.usdc, abi: usdcAbi, functionName: "transfer", args: [to as Hex, units] }, network);
    return NextResponse.json({ txHash: tx.hash });
  } catch (e) {
    return NextResponse.json({ error: ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).slice(0, 200) }, { status: 502 });
  }
}
