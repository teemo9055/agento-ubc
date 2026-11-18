import { NextResponse } from "next/server";
import { thread } from "@/server/town/boards";
import { formatOf, originOf, reply, threadDoc } from "@/server/town/format";

export const dynamic = "force-dynamic";

/** One Forum thread: the need, its replies and offers. `?format=md|json`. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = /^[A-Za-z0-9]{4,16}$/.test(id) ? thread("forum", id) : undefined;
  if (!r) return NextResponse.json({ error: "No Forum thread with that id" }, { status: 404 });
  return reply(formatOf(req), threadDoc("forum", r, originOf(req)));
}
