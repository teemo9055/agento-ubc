import { NextRequest, NextResponse } from "next/server";
import { SECTIONS, searchLibrary, type Section } from "@/server/town/library";

export const dynamic = "force-dynamic";

/** Search the Library: `?q=x402&section=basics`. */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100);
  const s = req.nextUrl.searchParams.get("section");
  const section = s && s in SECTIONS ? (s as Section) : undefined;
  return NextResponse.json({ sections: SECTIONS, entries: searchLibrary(q, section) }, { headers: { "access-control-allow-origin": "*" } });
}
