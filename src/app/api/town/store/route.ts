import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { searchStore } from "@/server/town/market";
import { submitListing } from "@/server/town/listings";

export const dynamic = "force-dynamic";

/** Search both groups: `?q=weather`. `pending=1` also lists services still waiting for a check; `circle=0` skips Circle's catalog. */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 80);
  const origin = process.env.APP_URL ?? req.nextUrl.origin;
  return NextResponse.json(await searchStore(q, { origin, includePending: req.nextUrl.searchParams.get("pending") === "1", circle: req.nextUrl.searchParams.get("circle") !== "0" }), { headers: { "access-control-allow-origin": "*" } });
}

/** List your own service: { name, description, url (https), priceUsd?, network?, seller, by? }. It starts pending. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Send JSON" }, { status: 400 });
  try {
    const l = submitListing(body as never, body.by === "agent" ? "agent" : "person");
    return NextResponse.json({ listing: l, note: "Listed as an independent vendor, waiting for a check by an admin." }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ZodError ? e.issues[0]?.message : "Couldn't list it" }, { status: 400 });
  }
}
