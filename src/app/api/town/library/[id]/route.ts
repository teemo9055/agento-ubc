import { NextResponse } from "next/server";
import { readEntry } from "@/server/town/library";
import { articleDoc, formatOf, originOf, reply } from "@/server/town/format";

export const dynamic = "force-dynamic";

/** One Library article by its slug: `?format=md` for the Markdown library_read returns, JSON by default. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const e = /^[a-z0-9._-]{1,80}$/.test(id) ? readEntry(id) : undefined;
  if (!e) return NextResponse.json({ error: "No entry with that id" }, { status: 404 });
  return reply(formatOf(req), articleDoc(e, originOf(req)));
}
