import { NextResponse } from "next/server";
import { thread } from "@/server/town/boards";
import { formatOf, originOf, reply, threadDoc } from "@/server/town/format";

export const dynamic = "force-dynamic";

/** One Lab thread: the request, its stage and every finding and solution. `?format=md|json`. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = /^[A-Za-z0-9]{4,16}$/.test(id) ? thread("lab", id) : undefined;
  if (!r) return NextResponse.json({ error: "No Lab thread with that id" }, { status: 404 });
  return reply(formatOf(req), threadDoc("lab", r, originOf(req)));
}
