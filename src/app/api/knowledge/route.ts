import { NextRequest, NextResponse } from "next/server";
import { allLessons, forgetLesson, lessonLines, PRIMERS } from "@/server/knowledge";
import type { AgentId } from "@/lib/types";

export const dynamic = "force-dynamic";

const AGENTS: AgentId[] = ["inso", "trado", "worko"];

/** What the agents know: built-in primers, lessons learned from past moves, and the raw outcomes behind them. */
export async function GET(req: NextRequest) {
  const a = req.nextUrl.searchParams.get("agent") as AgentId | null;
  const agents = a && AGENTS.includes(a) ? [a] : AGENTS;
  return NextResponse.json(
    Object.fromEntries(agents.map((id) => [id, { primers: PRIMERS[id], lessons: lessonLines(id, 20), outcomes: allLessons(id).slice(0, 100) }])),
  );
}

/** Forget one outcome. */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  forgetLesson(id);
  return NextResponse.json({ ok: true });
}
