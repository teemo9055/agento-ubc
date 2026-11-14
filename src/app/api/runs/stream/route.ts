import { summarize } from "@/lib/summary";
import { listRuns, watchAll } from "@/server/orchestrator";

export const dynamic = "force-dynamic";

/** Live job list: a snapshot, then one summary per change (coalesced per run). */
export async function GET(req: Request) {
  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          stop();
        }
      };
      send("snapshot", listRuns().map(summarize));
      const pending = new Map<string, ReturnType<typeof setTimeout>>();
      const unwatch = watchAll((run) => {
        if (pending.has(run.id)) return;
        pending.set(
          run.id,
          setTimeout(() => {
            pending.delete(run.id);
            const latest = listRuns().find((r) => r.id === run.id);
            if (latest) send("upsert", summarize(latest));
          }, 150),
        );
      });
      const ping = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": ping\n\n"));
        } catch {
          stop();
        }
      }, 15_000);
      stop = () => {
        unwatch();
        clearInterval(ping);
        for (const t of pending.values()) clearTimeout(t);
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener("abort", () => stop());
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
