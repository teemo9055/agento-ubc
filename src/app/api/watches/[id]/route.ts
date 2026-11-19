import { NextRequest, NextResponse } from "next/server";
import { stopWatch, watchById } from "@/server/watches";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const w = watchById((await ctx.params).id);
  return w ? NextResponse.json(w) : NextResponse.json({ error: "No such watch" }, { status: 404 });
}

/** Stop it: no more checks. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const w = stopWatch((await ctx.params).id);
  return w ? NextResponse.json(w) : NextResponse.json({ error: "No such watch" }, { status: 404 });
}
