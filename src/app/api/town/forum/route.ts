import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { addPost, board } from "@/server/town/boards";
import { boardDoc, formatOf, originOf, reply } from "@/server/town/format";

export const dynamic = "force-dynamic";

/** The Forum: open needs routed here, with proposed solutions and offers of a service. `format=md|json` for the agent document (threads). */
export async function GET(req: NextRequest) {
  const rows = board("forum");
  const doc = boardDoc("forum", originOf(req), rows);
  if (req.nextUrl.searchParams.has("format") || /text\/markdown/.test(req.headers.get("accept") ?? "")) return reply(formatOf(req), doc);
  return NextResponse.json({ board: rows, ...doc.json }, { headers: { "access-control-allow-origin": "*" } });
}

/** Propose a solution or offer a service on a need: { itemId, kind: "solution" | "offer", text, url? (https, for offers), priceUsd?, from?, by? }. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Send JSON" }, { status: 400 });
  try {
    return NextResponse.json({ post: addPost({ ...(body as object), board: "forum" } as never, body.by === "agent" ? "agent" : "person") }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ZodError ? e.issues[0]?.message : (e as Error).message }, { status: 400 });
  }
}
