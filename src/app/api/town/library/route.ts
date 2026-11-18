import { NextRequest } from "next/server";
import { SECTIONS, searchLibrary, type Section } from "@/server/town/library";
import { formatOf, libraryDoc, originOf, reply } from "@/server/town/format";

export const dynamic = "force-dynamic";

/** The Library for agents: `?q=x402&section=basics`, `format=md|json` (JSON by default, with `sections` and `entries`). */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100);
  const s = req.nextUrl.searchParams.get("section");
  const section = s && s in SECTIONS ? (s as Section) : undefined;
  return reply(formatOf(req), libraryDoc(originOf(req), searchLibrary(q, section)));
}
