import { NextRequest, NextResponse } from "next/server";
import { SELLERS, priceAt, type Seller } from "@/server/sellers";
import { recordSale } from "@/server/sales";
import { answerHash } from "@/server/delivery";
import { BadInput, PRODUCTS, decodeHeader, encodeHeader, netOfCaip, payToOn, requirements, sellsOn, verifyAndSettle, type PaymentPayload } from "@/server/x402";
import { NETS, type Net } from "@/lib/networks";

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
  const resource = req.nextUrl.pathname + req.nextUrl.search;
  // One price, on every network this seller can settle on; the buyer pays on the one its money is on.
  // Town Hall deposits stay on testnet: they follow the practice/testnet setting, never real money by default.
  const nets: Net[] = id === "hall.request" ? ["testnet"] : NETS.filter(sellsOn);
  const accepts = nets.map((n) => requirements(product, resource, payToOn(n, seller.address), price, n));
  const reqs = accepts[0];

  if (fault === "seller_402_timeout") {
    await new Promise((r) => setTimeout(r, 15_000));
    return NextResponse.json({ error: "timeout" }, { status: 504 });
  }

  const header = req.headers.get("x-payment");
  if (!header) {
    return NextResponse.json({ x402Version: 1, error: "payment required", accepts }, { status: 402, headers: { "access-control-allow-origin": "*" } });
  }

  if (fault === "settle_fails") {
    return NextResponse.json({ x402Version: 1, error: "settlement failed", accepts }, { status: 402 });
  }

  let data: unknown;
  try {
    data = await product.run(q);
  } catch (e) {
    // Nothing has been charged yet: a bad request costs the buyer nothing.
    const theirs = id === "cover.quote" || e instanceof BadInput;
    return NextResponse.json({ error: theirs ? (e as Error).message : "upstream data unavailable" }, { status: theirs ? 400 : 502 });
  }

  let settled;
  let paid = reqs;
  try {
    const payload = decodeHeader<PaymentPayload>(header);
    paid = accepts.find((r) => r.network === payload.network) ?? reqs;
    settled = await verifyAndSettle(payload, paid);
  } catch (e) {
    return NextResponse.json({ x402Version: 1, error: (e as Error).message, accepts }, { status: 402 });
  }

  // Test switch: the seller takes the money and sends an empty answer, so the delivery check and refund can be seen.
  if (fault === "bad_delivery") data = {};
  const auth = decodeHeader<PaymentPayload>(header).payload.authorization;
  const payer = auth.from;
  const params = Object.fromEntries([...q.entries()].filter(([k]) => k !== "seller"));
  const kept = JSON.stringify(data ?? null);
  const sale = recordSale({
    product: id,
    payer,
    amount: price.toString(),
    tx: settled.hash,
    network: netOfCaip(paid.network),
    own: req.headers.get("x-agento-buyer") === "job",
    nonce: auth.nonce,
    params,
    answerHash: answerHash(data),
    // Kept so a lost answer can be sent again; very large answers are only fingerprinted.
    answer: kept.length <= 200_000 ? kept : undefined,
  });
  product.settled?.(sale, data);
  const res = NextResponse.json({ data });
  res.headers.set(
    "x-payment-response",
    encodeHeader({ success: true, transaction: settled.hash, network: paid.network, payer: decodeHeader<PaymentPayload>(header).payload.authorization.from, fee: settled.fee }),
  );
  return res;
}
