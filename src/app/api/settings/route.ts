import { NextRequest, NextResponse } from "next/server";
import { limits, setLimits } from "@/server/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ limits: limits() });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { limits?: unknown };
    return NextResponse.json({ limits: setLimits(body.limits ?? {}) });
  } catch {
    return NextResponse.json({ error: "Those limits are out of range" }, { status: 400 });
  }
}
