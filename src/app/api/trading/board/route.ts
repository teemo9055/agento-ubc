import { NextResponse } from "next/server";
import { positions, predictionAccount, tradingStatus, VENUE_NAME } from "@/server/exchange";
import { listRuns } from "@/server/orchestrator";
import { doesLine } from "@/lib/plain";

export const dynamic = "force-dynamic";

/**
 * Trado's board: what you bought and sold, what you hold, orders still waiting, and your cash.
 * All of it from the connected exchange and your own jobs; practice orders are marked as such.
 */
export async function GET() {
  const [status, held] = await Promise.all([tradingStatus(), positions().catch(() => ({ venue: "paper" as const, positions: [] }))]);
  const orders = listRuns()
    .filter((r) => r.order && r.proposal?.action && r.proposal.action.kind !== "itinerary")
    .map((r) => {
      const a = r.proposal!.action!;
      const sell = (a.kind === "prediction_order" && a.trade === "sell") || (a.kind === "spot_order" && a.side === "sell");
      return {
        runId: r.id,
        title: r.proposal!.title,
        what: `${doesLine(a).label}, ${doesLine(a).detail}`,
        side: sell ? ("sell" as const) : ("buy" as const),
        status: r.order!.status,
        practice: r.order!.status === "simulated",
        notional: r.order!.notional ?? 0,
        at: r.order!.updatedAt ?? r.finishedAt ?? r.createdAt,
      };
    })
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  // Straight from Gemini's prediction-market API: what's waiting, what's held, what filled.
  const runs = listRuns();
  const symbols = runs.flatMap((r) => (r.proposal?.action?.kind === "prediction_order" ? [r.proposal.action.symbol] : []));
  const jobOf = (orderId: string) => runs.find((r) => r.order?.orderId === orderId)?.id;
  const account = await predictionAccount(symbols).catch((e) => ({ venue: status.venue, openOrders: [], positions: [], recent: [], error: (e as Error).message }));
  const gemini = {
    venue: account.venue,
    venueName: VENUE_NAME[account.venue],
    error: "error" in account ? account.error : undefined,
    openOrders: account.openOrders.map((o) => ({ ...o, runId: jobOf(o.orderId) })),
    positions: account.positions.map((p) => ({ symbol: p.symbol, label: p.label, event: p.event, outcome: p.outcome, quantity: p.quantity, avgPrice: p.avgPrice, sellPrice: p.sellPrice, runId: runs.find((r) => r.proposal?.action?.kind === "prediction_order" && r.proposal.action.symbol === p.symbol)?.id })),
    recent: account.recent.map((o) => ({ ...o, runId: jobOf(o.orderId) })),
  };
  const done = orders.filter((o) => o.status === "filled" || o.status === "simulated");
  const pending = orders.filter((o) => o.status === "open");
  return NextResponse.json({
    venue: status.venue,
    venueName: VENUE_NAME[status.venue],
    connected: status.connected,
    cash: status.usdAvailable ?? null,
    inOrders: pending.filter((o) => o.side === "buy").reduce((a, o) => a + o.notional, 0),
    bought: done.filter((o) => o.side === "buy").slice(0, 6),
    sold: done.filter((o) => o.side === "sell").slice(0, 6),
    pending: pending.slice(0, 8),
    gemini,
    holdings: held.positions.slice(0, 8).map((p) => ({ label: p.label, event: p.event, outcome: p.outcome, quantity: p.quantity, available: p.available, sellPrice: p.sellPrice })),
  });
}
