import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createRun, listRuns } from "@/server/orchestrator";

export const dynamic = "force-dynamic";

const FAULTS = ["seller_402_timeout", "payment_rejected", "settle_fails", "insufficient_balance", "policy_block", "price_increase", "model_error", "approval_timeout"] as const;

const Body = z.object({
  agent: z.enum(["inso", "trado", "travo"]),
  task: z.string().min(3).max(280),
  mode: z.enum(["demo", "live"]).default("demo"),
  faults: z.array(z.enum(FAULTS)).default([]),
});

export async function GET() {
  return NextResponse.json(listRuns());
}

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const body = parsed.data;
  if (process.env.ALLOW_FAULTS === "false") body.faults = [];
  try {
    return NextResponse.json(await createRun(body));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
