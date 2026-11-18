import { NextResponse } from "next/server";
import { getItem, publicView } from "@/server/town/hall";
import { formatOf, originOf, reply, ticketDoc } from "@/server/town/format";

export const dynamic = "force-dynamic";

/** Where an item is: received, refunded, kept as spam, routed, answered or set aside, with its history. `?format=md|json`. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const item = getItem(id);
  if (!item) return NextResponse.json({ error: "No item with that id" }, { status: 404 });
  return reply(formatOf(req), ticketDoc(publicView(item), originOf(req)));
}
