import { NextRequest, NextResponse } from "next/server";
import { liveAllowed } from "@/server/access";
import { crawlCatalog } from "@/server/catalog/crawl";
import { catalogFunnel, searchCapabilities } from "@/server/catalog/search";
import { reliability } from "@/server/catalog/store";
import { isIoType, type IoType } from "@/server/catalog/types";
import { catalogStats } from "@/server/marketplace";

export const dynamic = "force-dynamic";

/**
 * The capability map, for the app and for other agents.
 * GET ?stats=1                     how big the map is (and the live catalog's own count of what's payable)
 * GET ?q=…&outputs=phone,reviews&payable=now|mainnet|any&limit=8   search it
 * POST { accessCode? }             crawl the catalog now (gated like live jobs: it spends model calls)
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("stats")) {
    const live = await Promise.race([catalogStats().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 6000))]);
    return NextResponse.json({ ...catalogFunnel(), live: live ? { total: live.total, payableNow: live.payableNow, onArcMainnet: live.onArcMainnet, network: live.network } : null });
  }
  const q = (p.get("q") ?? "").slice(0, 200);
  const outputs = (p.get("outputs") ?? "").split(",").filter(isIoType) as IoType[];
  const payable = (["now", "mainnet", "any"] as const).find((x) => x === p.get("payable")) ?? "any";
  const limit = Math.min(25, Math.max(1, Number(p.get("limit") ?? 8) || 8));
  const hits = await searchCapabilities(q, { outputs: outputs.length ? outputs : undefined, payable, limit, readOnly: p.get("all") ? false : true });
  return NextResponse.json({
    results: hits.map(({ cap: c, score }) => ({
      name: c.name,
      provider: c.provider,
      resource: c.resource,
      method: c.method,
      description: c.description,
      priceUsd: c.priceUsd,
      payableNow: c.payableNow,
      payableMainnet: c.payableMainnet,
      readOnly: c.readOnly,
      inputs: c.inputs,
      outputs: c.outputs,
      answers: c.answers,
      reliability: reliability(c.resource),
      score: Math.round(score * 1000) / 1000,
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { accessCode?: string; max?: number };
  if (!liveAllowed(body.accessCode)) return NextResponse.json({ error: "Crawling the catalog needs the access code." }, { status: 403 });
  try {
    return NextResponse.json(await crawlCatalog({ max: typeof body.max === "number" ? body.max : undefined }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
