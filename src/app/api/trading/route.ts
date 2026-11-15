import { NextRequest, NextResponse } from "next/server";
import { acceptTerms, getTerms, selfTest, tradingStatus } from "@/server/exchange";

export const dynamic = "force-dynamic";

/** Which exchange orders go to, whether it's connected, terms status and USD available. */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("terms")) {
    try {
      return NextResponse.json(await getTerms());
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
  }
  return NextResponse.json(await tradingStatus());
}

/** Accepts Gemini's prediction-market terms, or runs the test-exchange check. Only from the user's own click. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action === "self-test") return NextResponse.json({ steps: await selfTest() });
  if (body.action !== "accept-terms") return NextResponse.json({ error: "unknown action" }, { status: 400 });
  try {
    await acceptTerms();
    return NextResponse.json(await tradingStatus());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
