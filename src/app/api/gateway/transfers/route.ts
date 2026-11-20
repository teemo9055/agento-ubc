import { NextRequest, NextResponse } from "next/server";
import { NETWORKS, type Net } from "@/lib/networks";

export const dynamic = "force-dynamic";

/** What Circle says about a Gateway payment: received, then settled on Arc in a batch transaction. */
export interface TransferProof {
  id: string;
  status: string;
  txHash: string | null;
  from?: string;
  to?: string;
  amount?: string;
}

const cache = new Map<string, { at: number; proof: TransferProof }>();
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function proofOf(id: string, net: Net): Promise<TransferProof> {
  const hit = cache.get(id);
  // A settled transfer never changes; one still waiting is asked again after a minute.
  if (hit && (hit.proof.txHash || Date.now() - hit.at < 60_000)) return hit.proof;
  const api = NETWORKS[net].gateway?.api ?? (net === "mainnet" ? "https://gateway-api.circle.com" : "https://gateway-api-testnet.circle.com");
  const r = await fetch(`${api}/v1/x402/transfers/${id}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Circle answered ${r.status}`);
  const d = (await r.json()) as { id: string; status: string; txHash: string | null; fromAddress?: string; toAddress?: string; amount?: string };
  const proof = { id: d.id, status: d.status, txHash: d.txHash, from: d.fromAddress, to: d.toAddress, amount: d.amount };
  cache.set(id, { at: Date.now(), proof });
  return proof;
}

/** GET ?ids=a,b&net=mainnet: the status of each Gateway transfer, from Circle. */
export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").filter((x) => ID.test(x)).slice(0, 40);
  const net = (req.nextUrl.searchParams.get("net") === "mainnet" ? "mainnet" : "testnet") as Net;
  const out = await Promise.all(ids.map((id) => proofOf(id, net).catch(() => ({ id, status: "unknown", txHash: null }))));
  return NextResponse.json({ transfers: out });
}
