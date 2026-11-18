import { NextResponse } from "next/server";
import { readEntry } from "@/server/town/library";

export const dynamic = "force-dynamic";

/** One Library entry by id. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const e = /^[a-z0-9._-]{1,80}$/.test(id) ? readEntry(id) : undefined;
  return e ? NextResponse.json(e, { headers: { "access-control-allow-origin": "*" } }) : NextResponse.json({ error: "No entry with that id" }, { status: 404 });
}
