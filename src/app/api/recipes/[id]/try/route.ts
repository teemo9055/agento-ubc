import { NextRequest, NextResponse } from "next/server";
import { learnedById } from "@/server/learn";
import { productFor } from "@/server/x402";
import { getRun } from "@/server/orchestrator";

export const dynamic = "force-dynamic";

/**
 * "Try buying it as an agent", in practice: the real price quote (HTTP 402) an outside agent gets
 * from this server, a practice payment (no money moves), and the shape of the answer it would get,
 * shown from the recipe's last real run so nothing is bought twice.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = learnedById(id);
  if (!r) return NextResponse.json({ error: "No such recipe" }, { status: 404 });
  const product = productFor(`recipe.${id}`);
  if (!product) return NextResponse.json({ error: "This recipe isn't on sale yet: it goes on sale once it has worked often enough." }, { status: 409 });
  const origin = process.env.APP_URL ?? req.nextUrl.origin;
  const url = `${origin}/api/x402/recipe.${id}?${product.example}`;
  const quote = await fetch(`${req.nextUrl.origin}/api/x402/recipe.${id}?${product.example}`, { cache: "no-store" })
    .then(async (x) => ({ status: x.status, body: await x.json().catch(() => null) }))
    .catch((e: Error) => ({ status: 0, body: { error: e.message } }));
  const last = [...r.from].reverse().map((j) => getRun(j)).find((j) => j?.report);
  return NextResponse.json({
    request: { method: "GET", url },
    quote,
    payment: { practice: true, note: "Practice: the agent would sign a USDC authorization for the quoted price; no money moved here." },
    answer: last?.report ? { from: "the recipe's last real run", report: last.report } : { note: "The answer is a report with the evidence for each claim, and a receipt of what was paid." },
  });
}
