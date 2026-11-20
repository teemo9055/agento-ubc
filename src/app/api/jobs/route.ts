import { NextRequest, NextResponse } from "next/server";
import { JOBS, SECTIONS } from "@/lib/jobs";
import { previews } from "@/server/jobs";
import { tradingVenue, venueReady } from "@/server/exchange";
import type { Venue } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The job catalog, with each card's live numbers for where the person wants orders to go. */
export async function GET(req: NextRequest) {
  const asked = req.nextUrl.searchParams.get("venue") as Venue | null;
  const venue: Venue = asked && venueReady(asked) ? asked : tradingVenue();
  const agent = req.nextUrl.searchParams.get("agent");
  const jobs = JOBS.filter((j) => !agent || j.agent === agent);
  const live = await previews(venue).catch(() => []);
  return NextResponse.json({ venue, sections: SECTIONS, jobs, previews: live.filter((p) => jobs.some((j) => j.id === p.id)) }, { headers: { "cache-control": "no-store" } });
}
