import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { HallInput, getItem, publicView } from "@/server/town/hall";
import { sendFromApp } from "@/server/town/deposit";
import { townMode } from "@/server/town";
import { liveAllowed } from "@/server/access";
import { formatOf, hallDoc, originOf, reply } from "@/server/town/format";

export const dynamic = "force-dynamic";

const Body = HallInput.extend({ mode: z.enum(["live", "demo"]).optional(), accessCode: z.string().max(200).optional() });

/**
 * A person sends something to Town Hall from the app. Practice mode (no wallets set up, or asked
 * for) records a practice deposit and moves no money; live, the app wallet pays the 1 USDC.
 * Agents pay the same deposit themselves at /api/x402/hall.request.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check what you sent" }, { status: 400 });
  const { mode, accessCode, ...input } = parsed.data;
  // Like a job: real money only when you chose Arc testnet in Settings, the wallets are set up, and (on a public server) with the access code.
  if (mode === "live" && townMode() === "live" && !liveAllowed(accessCode)) return NextResponse.json({ error: "Live deposits need the access code. Use practice, or ask the owner for the code." }, { status: 403 });
  const live = mode === "live" && townMode() === "live";
  const r = await sendFromApp(input, { live });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.status });
  return NextResponse.json({ item: publicView(r.item), statusUrl: `/town/hall/${r.item.id}` }, { status: 201 });
}

/** The public queue for agents (`format=md|json`), or the status of a few items at once, for "what I sent": `?ids=a,b,c`. */
export async function GET(req: NextRequest) {
  if (!req.nextUrl.searchParams.has("ids")) return reply(formatOf(req), hallDoc(originOf(req)));
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, 20);
  const items = ids.map((id) => getItem(id)).filter((i) => i !== undefined && i.deposit.state !== "awaiting");
  return NextResponse.json({ items: items.map((i) => publicView(i!)) });
}
