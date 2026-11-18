import { NextResponse } from "next/server";
import { findStoreItem } from "@/server/town/market";
import { formatOf, originOf, reply, storeItemDoc } from "@/server/town/format";

export const dynamic = "force-dynamic";

/** One Store item by its stable id (agento-…, listing-…, circle-…): `?format=md|json`. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const base = originOf(req);
  const item = /^[a-z0-9._-]{4,80}$/i.test(id) ? await findStoreItem(id, base) : undefined;
  if (!item) return NextResponse.json({ error: "No Store item with that id" }, { status: 404 });
  return reply(formatOf(req), storeItemDoc(item, base));
}
