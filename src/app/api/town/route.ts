import { NextResponse } from "next/server";
import { townSummary } from "@/server/town";

export const dynamic = "force-dynamic";

/** The town at a glance: mode, wallet balance (live only), and counts from what is stored. */
export async function GET() {
  return NextResponse.json(await townSummary());
}
