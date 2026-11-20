import { notPossible } from "@/lib/impossible";
import { NextRequest, NextResponse } from "next/server";
import { liveAllowed } from "@/server/access";
import { z } from "zod";
import { createRun, listRuns, offerPlan } from "@/server/orchestrator";
import { buildShowcase } from "@/server/showcase";
import { randomUUID } from "node:crypto";
import { summarize } from "@/lib/summary";
import { routeAgent } from "@/server/route";

export const dynamic = "force-dynamic";

const FAULTS = ["seller_402_timeout", "payment_rejected", "settle_fails", "insufficient_balance", "policy_block", "price_increase", "model_error", "approval_timeout", "bad_delivery"] as const;

const Body = z.object({
  // "auto": the server picks the agent that fits the request.
  agent: z.enum(["auto", "inso", "trado", "worko"]),
  task: z.string().min(3).max(1000),
  mode: z.enum(["demo", "live"]).default("demo"),
  faults: z.array(z.enum(FAULTS)).default([]),
  accessCode: z.string().max(200).optional(),
  /** Start from a ready-made plan (built from live data, no model needed) and skip the first chat turn. */
  template: z.enum(["showcase"]).optional(),
  payerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  /** Which Arc network a live job's money moves on. */
  network: z.enum(["testnet", "mainnet"]).default("testnet"),
  /** Where orders go: practice, Gemini's test exchange, or Gemini with real money. */
  venue: z.enum(["paper", "gemini-sandbox", "gemini"]).optional(),
});

export async function GET(req: NextRequest) {
  const runs = listRuns();
  return NextResponse.json(req.nextUrl.searchParams.get("full") ? runs : runs.map(summarize));
}

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const body = parsed.data;
  if (process.env.ALLOW_FAULTS === "false") body.faults = [];
  // Jobs paid by the user's own passkey wallet spend their money, not the app's, so they need no code.
  // A plan (the showcase included) is always paid from the app's wallet, so it always needs the code.
  if (body.mode === "live" && (!body.payerAddress || body.template) && !liveAllowed(body.accessCode)) return NextResponse.json({ error: `${body.network === "mainnet" ? "Arc mainnet jobs paid from the app's wallet" : "Arc testnet jobs"} need the access code. Use practice, pay from your own passkey wallet, or ask the owner for the code.` }, { status: 403 });
  // Something no service here can ever do never becomes a job: say so, and offer what can be done.
  const no = body.template ? null : notPossible(body.task, { mainnet: body.mode === "live" && body.network === "mainnet" });
  if (no) return NextResponse.json({ error: no.what, notPossible: no }, { status: 422 });
  try {
    if (body.template === "showcase") {
      const built = await buildShowcase(randomUUID().slice(0, 8));
      if ("error" in built) return NextResponse.json({ error: built.error }, { status: 503 });
      const run = await createRun({ ...body, agent: "inso", payerAddress: undefined }, { quiet: true });
      return NextResponse.json(offerPlan(run.id, built.plan, "Here's a workflow made only of things that really run today. Change any step, or start it as it is."));
    }
    const agent = body.agent === "auto" ? await routeAgent(body.task) : body.agent;
    return NextResponse.json(await createRun({ ...body, agent, payerAddress: body.payerAddress as `0x${string}` | undefined }, { wait: false }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
