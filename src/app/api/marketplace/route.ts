import { NextRequest, NextResponse } from "next/server";
import { catalogStats, networkName, searchServices } from "@/server/marketplace";

export const dynamic = "force-dynamic";

/** The marketplace as the agents see it: how much is payable now, and a search over all of it. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.slice(0, 80) ?? "";
  const payable = req.nextUrl.searchParams.get("payable") === "1";
  try {
    const [stats, found] = await Promise.all([catalogStats(), q || payable ? searchServices(q, undefined, 12, payable) : Promise.resolve([])]);
    return NextResponse.json({
      stats,
      items: found.map((s) => ({ name: s.name, provider: s.provider, what: s.description, priceUsd: s.priceUsd, payableHere: s.payableHere, method: s.method, input: s.input, networks: s.networks.slice(0, 3).map(networkName) })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
