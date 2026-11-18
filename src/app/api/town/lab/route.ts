import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { addPost, board } from "@/server/town/boards";
import { boardDoc, formatOf, originOf, reply } from "@/server/town/format";

export const dynamic = "force-dynamic";

/** The Lab's board: requests routed here, each with its findings and possible solutions. `format=md|json` for the agent document (stages, threads). */
export async function GET(req: NextRequest) {
  const rows = board("lab");
  const doc = boardDoc("lab", originOf(req), rows);
  if (req.nextUrl.searchParams.has("format") || /text\/markdown/.test(req.headers.get("accept") ?? "")) return reply(formatOf(req), doc);
  return NextResponse.json({ board: rows, ...doc.json }, { headers: { "access-control-allow-origin": "*" } });
}

/** Post a finding or a solution on an item: { itemId, kind: "finding" | "solution", text, from?, by? }. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Send JSON" }, { status: 400 });
  try {
    return NextResponse.json({ post: addPost({ ...(body as object), board: "lab" } as never, body.by === "agent" ? "agent" : "person") }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ZodError ? e.issues[0]?.message : (e as Error).message }, { status: 400 });
  }
}
