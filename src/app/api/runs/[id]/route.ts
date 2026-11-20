import { NextResponse } from "next/server";
import { getRun, removeRun, settleRun } from "@/server/orchestrator";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = (await ctx.params).id;
  const run = getRun(id);
  // Opening a job whose market has closed looks up how it resolved; the result arrives on the job's stream.
  if (run?.status === "done" && !run.settlement && run.order) void settleRun(id).catch(() => undefined);
  return run ? NextResponse.json(run) : NextResponse.json({ error: "not found" }, { status: 404 });
}

/** Deletes a job (stopped or finished ones only). */
export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = removeRun((await ctx.params).id);
  return "error" in r ? NextResponse.json(r, { status: 409 }) : NextResponse.json(r);
}
