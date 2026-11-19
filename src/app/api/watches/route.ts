import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRun } from "@/server/orchestrator";
import { allWatches, createWatch } from "@/server/watches";

export const dynamic = "force-dynamic";

const Body = z.object({
  runId: z.string().min(1),
  ref: z.string().regex(/^\$[A-Za-z][A-Za-z0-9_-]*(\..+)?$/),
  op: z.enum(["<=", ">=", "==", "!=", "changed"]),
  value: z.union([z.string().max(100), z.number()]).optional(),
  every: z.enum(["15m", "1h", "6h", "1d"]),
  days: z.number().int().min(1).max(30),
});

/** Watches, newest checks last. */
export async function GET() {
  return NextResponse.json({ watches: allWatches() });
}

/** Watch something a finished job found, until a condition is met. One approval covers every check up to the total. */
export async function POST(req: NextRequest) {
  const b = Body.safeParse(await req.json().catch(() => ({})));
  if (!b.success) return NextResponse.json({ error: b.error.issues[0]?.message ?? "Check the watch" }, { status: 400 });
  const run = getRun(b.data.runId);
  if (!run) return NextResponse.json({ error: "No such job" }, { status: 404 });
  if (b.data.op !== "changed" && b.data.value === undefined) return NextResponse.json({ error: "Give the value to compare with" }, { status: 400 });
  const w = createWatch(run, { condition: { ref: b.data.ref, op: b.data.op, value: b.data.value }, every: b.data.every, days: b.data.days });
  if ("error" in w) return NextResponse.json(w, { status: 400 });
  return NextResponse.json(w);
}
