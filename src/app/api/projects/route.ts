import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createProject } from "@/server/orchestrator";

export const dynamic = "force-dynamic";

/** Starts an empty project to add jobs to. Body: { title, mode? }. */
export async function POST(req: NextRequest) {
  const body = z.object({ title: z.string().min(1).max(80), mode: z.enum(["demo", "live"]).optional() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Give the project a name" }, { status: 400 });
  const run = await createProject(body.data.title, body.data.mode);
  return NextResponse.json({ id: run.id, url: `/projects/${run.id}` });
}
