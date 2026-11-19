import { NextRequest, NextResponse } from "next/server";
import { SELLERS } from "@/server/sellers";
import { salesSummary } from "@/server/sales";
import { NETWORK, forSale, payToOn, refundPolicy, sellsOn } from "@/server/x402";
import { chainOf } from "@/server/chain";
import { NETS, NETWORKS, type Net } from "@/lib/networks";

export const dynamic = "force-dynamic";

/** What this app sells to other agents, per request, and what it has earned doing it. */
export async function GET(req: NextRequest) {
  const origin = process.env.APP_URL ?? req.nextUrl.origin;
  const resources = forSale().map((p) => ({
    resource: `${origin}/api/x402/${p.id}`,
    type: "http",
    method: "GET",
    description: p.description,
    priceUsd: Number(p.price) / 1e6,
    params: p.params,
    example: `${origin}/api/x402/${p.id}?${p.example}`,
    refund: refundPolicy(origin, p),
    ...(p.id.startsWith("recipe.") ? { kind: "learned recipe", seller: "Agento" } : {}),
    accepts: (p.id === "hall.request" ? (["testnet"] as Net[]) : NETS.filter(sellsOn).filter((n) => !p.nets || p.nets.includes(n))).map((n) => ({ scheme: "exact", network: NETWORKS[n].caip, asset: chainOf(n).usdc, payTo: payToOn(n, SELLERS.primary.address), maxAmountRequired: p.price.toString() })),
  }));
  return NextResponse.json(
    { x402Version: 1, name: "Agento", network: NETWORK, networks: NETS.filter(sellsOn).map((n) => NETWORKS[n].caip), payTo: SELLERS.primary.address, openapi: `${origin}/api/x402/openapi.json`, resources, sales: salesSummary() },
    { headers: { "access-control-allow-origin": "*" } },
  );
}
