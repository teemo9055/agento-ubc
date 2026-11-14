import { NextResponse } from "next/server";
import { getRun } from "@/server/orchestrator";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const run = getRun((await ctx.params).id);
  return run ? NextResponse.json(run) : NextResponse.json({ error: "not found" }, { status: 404 });
}
