import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createRun, listRuns } from "@/server/orchestrator";
import { summarize } from "@/lib/summary";

export const dynamic = "force-dynamic";

const FAULTS = ["seller_402_timeout", "payment_rejected", "settle_fails", "insufficient_balance", "policy_block", "price_increase", "model_error", "approval_timeout"] as const;

const Body = z.object({
  agent: z.enum(["inso", "trado", "travo"]),
  task: z.string().min(3).max(280),
  mode: z.enum(["demo", "live"]).default("demo"),
  faults: z.array(z.enum(FAULTS)).default([]),
  accessCode: z.string().max(200).optional(),
});

/** Live (Arc testnet) jobs spend the funded wallets, so a public deployment gates them with a code. */
function liveAllowed(code?: string) {
  const want = process.env.LIVE_ACCESS_CODE;
  if (!want) return true;
  const a = Buffer.from(code ?? "");
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const runs = listRuns();
  return NextResponse.json(req.nextUrl.searchParams.get("full") ? runs : runs.map(summarize));
}

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const body = parsed.data;
  if (process.env.ALLOW_FAULTS === "false") body.faults = [];
  if (body.mode === "live" && !liveAllowed(body.accessCode)) return NextResponse.json({ error: "Arc testnet jobs need the access code. Use the demo rail, or ask the owner for the code." }, { status: 403 });
  try {
    return NextResponse.json(await createRun(body));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
