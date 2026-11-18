import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { addPost, board } from "@/server/town/boards";

export const dynamic = "force-dynamic";

/** The Forum: open needs routed here, with proposed solutions and offers of a service. */
export async function GET() {
  return NextResponse.json({ board: board("forum") }, { headers: { "access-control-allow-origin": "*" } });
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
