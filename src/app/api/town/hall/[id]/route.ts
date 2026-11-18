import { NextResponse } from "next/server";
import { getItem, publicView } from "@/server/town/hall";

export const dynamic = "force-dynamic";

/** Where an item is: received, refunded, kept as spam, routed, answered or set aside, with its history. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const item = getItem(id);
  if (!item) return NextResponse.json({ error: "No item with that id" }, { status: 404 });
  return NextResponse.json(publicView(item), { headers: { "access-control-allow-origin": "*" } });
}
