import { NextRequest, NextResponse } from "next/server";
import { NETWORK, PRODUCTS } from "@/server/x402";

export const dynamic = "force-dynamic";

/**
 * The OpenAPI description of what this app sells, so another agent (or a marketplace listing)
 * can read each endpoint's inputs and its price before paying.
 */
export async function GET(req: NextRequest) {
  const origin = process.env.APP_URL ?? req.nextUrl.origin;
  const paths = Object.fromEntries(
    Object.values(PRODUCTS).map((p) => [
      `/api/x402/${p.id}`,
      {
        get: {
          operationId: p.id.replace(/\W+/g, "_"),
          summary: p.description,
          description: `${p.description}. Costs ${Number(p.price) / 1e6} USDC per request, paid over x402 (scheme exact) on ${NETWORK}. An unpaid request answers 402 with what to pay; repeat it with an X-PAYMENT header.`,
          "x-price-usd": Number(p.price) / 1e6,
          parameters: [
            ...Object.entries(p.params).map(([name, description]) => ({ name, in: "query", required: false, description, schema: { type: "string" } })),
            { name: "X-PAYMENT", in: "header", required: false, description: "Base64 x402 payment payload (EIP-3009 USDC authorization)", schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "The answer. The X-PAYMENT-RESPONSE header carries the settlement transaction.", content: { "application/json": { schema: { type: "object", properties: { data: {} } } } } },
            "402": { description: "Payment required: `accepts` lists the price, asset, network and payee." },
            "400": { description: "The request can't be answered as asked; nothing was charged." },
          },
        },
      },
    ]),
  );
  return NextResponse.json(
    { openapi: "3.0.3", info: { title: "Agento paid answers", version: "1.0.0", description: "Prediction-market data and cover quotes, sold per request in USDC over x402." }, servers: [{ url: origin }], paths },
    { headers: { "access-control-allow-origin": "*" } },
  );
}
