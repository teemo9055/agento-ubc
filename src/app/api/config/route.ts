import { NextResponse } from "next/server";
import { AGENTS } from "@/server/agents";
import { EXPLORER, FACTORY, aiKeyProblem, liveReady, setupProblems } from "@/server/chain";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    live: liveReady(),
    setup: [...setupProblems(), ...(aiKeyProblem() ? [aiKeyProblem()!] : [])],
    factory: FACTORY ?? null,
    explorer: EXPLORER,
    faultsEnabled: process.env.ALLOW_FAULTS !== "false",
    liveNeedsCode: Boolean(process.env.LIVE_ACCESS_CODE),
    agents: Object.values(AGENTS).map((a) => ({ id: a.id, name: a.name, tagline: a.tagline, examples: a.examples })),
  });
}
