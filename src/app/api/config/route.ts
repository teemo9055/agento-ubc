import { NextResponse } from "next/server";
import { AGENTS } from "@/server/agents";
import { EXPLORER, FACTORY, aiKeyProblem, liveReady, setupProblems } from "@/server/chain";
import { circleWallets } from "@/server/circle";
import { gatewayStatus } from "@/server/nanopay";

export const dynamic = "force-dynamic";

export async function GET() {
  // Warn before marketplace purchases stop for lack of funds, not after a job fails.
  const gateway = circleWallets.agent && !process.env.MARKET_DATA ? await Promise.race([gatewayStatus().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 4000))]) : null;
  return NextResponse.json({
    live: liveReady(),
    setup: [...setupProblems(), ...(aiKeyProblem() ? [aiKeyProblem()!] : []), ...(gateway?.warning ? [gateway.warning] : [])],
    gateway: gateway ? { balance: gateway.balance, depositedToday: gateway.depositedToday, dailyCap: gateway.dailyCap } : null,
    factory: FACTORY ?? null,
    explorer: EXPLORER,
    faultsEnabled: process.env.ALLOW_FAULTS !== "false",
    liveNeedsCode: Boolean(process.env.LIVE_ACCESS_CODE),
    agents: Object.values(AGENTS).map((a) => ({ id: a.id, name: a.name, tagline: a.tagline, examples: a.examples })),
  });
}
