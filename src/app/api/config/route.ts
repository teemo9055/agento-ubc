import { NextResponse } from "next/server";
import { AGENTS } from "@/server/agents";
import { EXPLORER, FACTORY, MAINNET_MAX_JOB_USD, aiKeyProblem, chainOf, liveReady, setupProblems } from "@/server/chain";
import { NETS, NETWORKS } from "@/lib/networks";
import { circleWallets } from "@/server/circle";
import { gatewayStatus } from "@/server/nanopay";
import { tradingVenue, venues, VENUE_NAME } from "@/server/exchange";

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
    // Both Arc networks, side by side: whether live jobs can run on each, and what's missing if not.
    networks: Object.fromEntries(
      NETS.map((n) => [
        n,
        {
          name: NETWORKS[n].name,
          chainId: NETWORKS[n].chainId,
          explorer: chainOf(n).explorer,
          live: liveReady(n),
          setup: setupProblems(n),
          factory: chainOf(n).factory ?? null,
          maxJobUsd: n === "mainnet" ? MAINNET_MAX_JOB_USD : null,
          realMoney: NETWORKS[n].realMoney,
        },
      ]),
    ),
    // Where orders can go on this server, and where they go by default.
    venues: venues().map((v) => ({ id: v, name: VENUE_NAME[v] })),
    defaultVenue: tradingVenue(),
    agents: Object.values(AGENTS).map((a) => ({ id: a.id, name: a.name, tagline: a.tagline, examples: a.examples })),
  });
}
