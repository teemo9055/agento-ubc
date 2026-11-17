import { NextRequest, NextResponse } from "next/server";
import { SELLERS } from "@/server/sellers";
import { salesSummary } from "@/server/sales";
import { NETWORK, PRODUCTS } from "@/server/x402";
import { USDC } from "@/server/chain";

export const dynamic = "force-dynamic";

/** What this app sells to other agents, per request, and what it has earned doing it. */
export async function GET(req: NextRequest) {
  const origin = process.env.APP_URL ?? req.nextUrl.origin;
  const resources = Object.values(PRODUCTS).map((p) => ({
    resource: `${origin}/api/x402/${p.id}`,
    type: "http",
    method: "GET",
    description: p.description,
    priceUsd: Number(p.price) / 1e6,
    params: p.params,
    example: `${origin}/api/x402/${p.id}?${p.example}`,
    accepts: [{ scheme: "exact", network: NETWORK, asset: USDC, payTo: SELLERS.primary.address, maxAmountRequired: p.price.toString() }],
  }));
  return NextResponse.json(
    { x402Version: 1, name: "Agento", network: NETWORK, payTo: SELLERS.primary.address, openapi: `${origin}/api/x402/openapi.json`, resources, sales: salesSummary() },
    { headers: { "access-control-allow-origin": "*" } },
  );
}
