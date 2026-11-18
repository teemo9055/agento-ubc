import { NextRequest, NextResponse } from "next/server";
import { redeliver } from "@/server/refunds";

export const dynamic = "force-dynamic";

/** Sends an answer that was already paid for again, free, when it was lost on the way. `?payer=0x…&nonce=0x…` */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const r = redeliver(q.get("payer") ?? "", q.get("nonce") ?? "");
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.status });
  return NextResponse.json({ data: r.data, tx: r.sale.tx });
}
