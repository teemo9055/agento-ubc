import { NextRequest, NextResponse } from "next/server";
import { SELLERS, priceAt, type Seller } from "@/server/sellers";
import { recordSale } from "@/server/sales";
import { PRODUCTS, decodeHeader, encodeHeader, requirements, verifyAndSettle, type PaymentPayload } from "@/server/x402";

export const dynamic = "force-dynamic";

/** Pay-per-request market data (x402 `exact` on Arc). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ product: string }> }) {
  const { product: id } = await ctx.params;
  const product = PRODUCTS[id];
  if (!product) return NextResponse.json({ error: "unknown product" }, { status: 404 });

  const q = req.nextUrl.searchParams;
  const seller: Seller = SELLERS[(q.get("seller") as Seller["id"]) ?? "primary"] ?? SELLERS.primary;
  const fault = req.headers.get("x-agento-fault");
  const price = priceAt(product.price, seller) * (fault === "price_increase" ? 2n : 1n);
  const reqs = requirements(product, req.nextUrl.pathname + req.nextUrl.search, seller.address, price);

  if (fault === "seller_402_timeout") {
    await new Promise((r) => setTimeout(r, 15_000));
    return NextResponse.json({ error: "timeout" }, { status: 504 });
  }

  const header = req.headers.get("x-payment");
  if (!header) {
    return NextResponse.json({ x402Version: 1, error: "payment required", accepts: [reqs] }, { status: 402, headers: { "access-control-allow-origin": "*" } });
  }

  if (fault === "settle_fails") {
    return NextResponse.json({ x402Version: 1, error: "settlement failed", accepts: [reqs] }, { status: 402 });
  }

  let data: unknown;
  try {
    data = await product.run(q);
  } catch (e) {
    // Nothing has been charged yet: a bad request costs the buyer nothing.
    return NextResponse.json({ error: id === "cover.quote" ? (e as Error).message : "upstream data unavailable" }, { status: id === "cover.quote" ? 400 : 502 });
  }

  let settled;
  try {
    settled = await verifyAndSettle(decodeHeader<PaymentPayload>(header), reqs);
  } catch (e) {
    return NextResponse.json({ x402Version: 1, error: (e as Error).message, accepts: [reqs] }, { status: 402 });
  }

  const payer = decodeHeader<PaymentPayload>(header).payload.authorization.from;
  recordSale({ product: id, payer, amount: price.toString(), tx: settled.hash, own: req.headers.get("x-agento-buyer") === "job" });
  const res = NextResponse.json({ data });
  res.headers.set(
    "x-payment-response",
    encodeHeader({ success: true, transaction: settled.hash, network: reqs.network, payer: decodeHeader<PaymentPayload>(header).payload.authorization.from, fee: settled.fee }),
  );
  return res;
}
