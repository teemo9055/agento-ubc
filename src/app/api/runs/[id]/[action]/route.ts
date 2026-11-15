import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { SeqEvent } from "@/lib/events";
import { adopt, approve, backToChat, cancel, cancelRunOrder, refreshRunOrder, sendChat, decideReapproval, editCard, fundingInfo, previewEdit, reapprovalPlan, resolveFailure, subscribe } from "@/server/orchestrator";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; action: string }> };

const Edit = z.object({ card: z.enum(["deliverable", "risk", "method", "price"]), prompt: z.string().min(1).max(200) });
const Hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const Reapproval = z.object({ requestId: z.string(), outcome: z.enum(["approved", "denied"]), amount: z.string().regex(/^\d+$/).optional(), txHash: Hash.optional() });
const Failure = z.object({ failureId: z.string(), action: z.enum(["retry", "skip", "edit", "cancel", "topup"]), txHash: Hash.optional() });
const Chat = z.object({ text: z.string().min(1).max(600) });
const Adopt = z.object({ proposalId: z.string() });
const Approve = z.object({ txHash: Hash.optional() });

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id, action } = await ctx.params;
  try {
    switch (action) {
      case "chat": {
        const b = Chat.parse(await req.json());
        // The reply streams over events; don't hold the request open for it.
        void sendChat(id, b.text).catch((e) => console.warn("chat", e));
        return NextResponse.json({ ok: true });
      }
      case "adopt": {
        const b = Adopt.parse(await req.json());
        return NextResponse.json(await adopt(id, b.proposalId));
      }
      case "back":
        return NextResponse.json(backToChat(id));
      case "order-refresh":
        return NextResponse.json(await refreshRunOrder(id));
      case "order-cancel":
        return NextResponse.json(await cancelRunOrder(id));
      case "edit": {
        const b = Edit.parse(await req.json());
        return NextResponse.json(await editCard(id, b.card, b.prompt));
      }
      case "preview": {
        const b = Edit.parse(await req.json());
        return NextResponse.json(await previewEdit(id, b.card, b.prompt));
      }
      case "approve": {
        const b = Approve.parse(await req.json().catch(() => ({})));
        return NextResponse.json(await approve(id, { txHash: b.txHash as `0x${string}` | undefined }));
      }
      case "reapproval": {
        const b = Reapproval.parse(await req.json());
        decideReapproval(id, b.requestId, b.outcome, b.amount, b.txHash as `0x${string}` | undefined);
        return NextResponse.json({ ok: true });
      }
      case "failure": {
        const b = Failure.parse(await req.json());
        resolveFailure(id, b.failureId, b.action, b.txHash as `0x${string}` | undefined);
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
  try {
    if (action === "funding") return NextResponse.json(fundingInfo(id));
    if (action === "reapproval-plan") {
      const q = req.nextUrl.searchParams;
      return NextResponse.json(reapprovalPlan(id, q.get("requestId") ?? "", q.get("amount") ?? undefined));
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
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
