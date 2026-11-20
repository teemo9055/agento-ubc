import { NextRequest, NextResponse } from "next/server";
import { accountCheck, tradingVenue, venueReady, withVenue } from "@/server/exchange";
import type { Venue } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Which Gemini account Agento trades on, and the prediction orders on it: `?venue=gemini-sandbox|gemini`. */
export async function GET(req: NextRequest) {
  const asked = req.nextUrl.searchParams.get("venue") as Venue | null;
  const venue: Venue = asked && asked !== "paper" && venueReady(asked) ? asked : tradingVenue();
  const r = await withVenue(venue, () => accountCheck());
  return NextResponse.json(r, { headers: { "cache-control": "no-store" } });
}
