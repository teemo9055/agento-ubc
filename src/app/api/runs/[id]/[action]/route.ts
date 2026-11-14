import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { SeqEvent } from "@/lib/events";
import { approve, cancel, decideReapproval, editCard, resolveFailure, subscribe } from "@/server/orchestrator";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; action: string }> };

const Edit = z.object({ card: z.enum(["deliverable", "risk", "method", "price"]), prompt: z.string().min(1).max(200) });
const Reapproval = z.object({ requestId: z.string(), outcome: z.enum(["approved", "denied"]) });
const Failure = z.object({ failureId: z.string(), action: z.enum(["retry", "skip", "switch", "edit", "cancel", "topup"]) });

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id, action } = await ctx.params;
  try {
    switch (action) {
      case "edit": {
        const b = Edit.parse(await req.json());
        return NextResponse.json(await editCard(id, b.card, b.prompt));
      }
      case "approve":
        return NextResponse.json(await approve(id));
      case "reapproval": {
        const b = Reapproval.parse(await req.json());
        decideReapproval(id, b.requestId, b.outcome);
        return NextResponse.json({ ok: true });
      }
      case "failure": {
        const b = Failure.parse(await req.json());
        resolveFailure(id, b.failureId, b.action);
        return NextResponse.json({ ok: true });
      }
      case "cancel":
        return NextResponse.json(await cancel(id));
    }
    return NextResponse.json({ error: "unknown action" }, { status: 404 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** Server-sent events: the full event log, then live events. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id, action } = await ctx.params;
  if (action !== "events") return NextResponse.json({ error: "unknown" }, { status: 404 });
  const enc = new TextEncoder();
  let unsub: (() => void) | null = null;
  let ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (e: SeqEvent) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      const u = subscribe(id, send);
      if (!u) {
        controller.enqueue(enc.encode(`event: missing\ndata: {}\n\n`));
        controller.close();
        return;
      }
      unsub = () => void u();
      ping = setInterval(() => controller.enqueue(enc.encode(`: ping\n\n`)), 15_000);
      req.signal.addEventListener("abort", () => {
        unsub?.();
        clearInterval(ping);
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      unsub?.();
      clearInterval(ping);
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
