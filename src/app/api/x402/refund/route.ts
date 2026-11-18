import { NextRequest, NextResponse } from "next/server";
import { claimRefund } from "@/server/refunds";

export const dynamic = "force-dynamic";

/**
 * Refund claim for a paid answer that failed a published check.
 * Body: { tx: settlement transaction, payer: address that paid, answer: the `data` received }.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { tx?: string; payer?: string; answer?: unknown } | null;
  if (!body?.tx || !body.payer || !("answer" in body)) return NextResponse.json({ error: "Send tx, payer and answer" }, { status: 400 });
  const r = await claimRefund({ tx: body.tx, payer: body.payer, answer: body.answer });
  if (!r.ok) return NextResponse.json({ refunded: false, error: r.reason }, { status: r.status });
  return NextResponse.json({ refunded: true, amount: r.amount, refundTx: r.refundTx, failed: r.verdict });
}
