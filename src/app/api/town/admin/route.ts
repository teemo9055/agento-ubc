import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { act, adminCheck, AdminAction, inbox } from "@/server/town/admin";

export const dynamic = "force-dynamic";

/** The admin inbox. Needs the x-admin-key header; off when ADMIN_KEY isn't set. */
export async function GET(req: NextRequest) {
  const a = adminCheck(req.headers);
  if (!a.ok) return NextResponse.json({ error: a.reason }, { status: a.status });
  return NextResponse.json({ who: a.who, ...inbox() });
}

/** One decision: refund, spam, abandon, route, accept (Lab → Library), trust (Forum → Store), approve-listing, reject-listing. Logged. */
export async function POST(req: NextRequest) {
  const a = adminCheck(req.headers);
  if (!a.ok) return NextResponse.json({ error: a.reason }, { status: a.status });
  const parsed = AdminAction.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Unknown action" }, { status: 400 });
  try {
    const r = await act(parsed.data, a.who);
    return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.reason }, { status: r.status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ZodError ? e.issues[0]?.message : (e as Error).message }, { status: 400 });
  }
}
