import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { addPost, board } from "@/server/town/boards";

export const dynamic = "force-dynamic";

/** The Lab's mailbox: requests routed here, each with its findings and possible solutions. */
export async function GET() {
  return NextResponse.json({ board: board("lab") }, { headers: { "access-control-allow-origin": "*" } });
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
