import { follow, type Watch } from "@/server/live";
import { marketBase } from "@/server/exchange";
import type { Venue } from "@/lib/types";

export const dynamic = "force-dynamic";

const OK = /^[A-Za-z0-9._-]{2,80}$/;

/** Live prices for up to eight contracts: `?w=EVENT:SYMBOL&w=…&venue=gemini-sandbox`. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const watches: Watch[] = url.searchParams
    .getAll("w")
    .map((w) => w.split(":"))
    .filter((p) => p.length === 2 && OK.test(p[0]) && OK.test(p[1]))
    .slice(0, 8)
    .map(([eventTicker, symbol]) => ({ eventTicker, symbol }));
  if (!watches.length) return Response.json({ error: "nothing to watch" }, { status: 400 });
  const venue = url.searchParams.get("venue");
  const base = venue === "gemini-sandbox" ? marketBase(venue as Venue) : undefined;
  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const write = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          stop();
        }
      };
      const unfollow = follow(watches, base, (ticks) => write(`data: ${JSON.stringify(ticks)}\n\n`));
      const ping = setInterval(() => write(": ping\n\n"), 15_000);
      stop = () => {
        unfollow();
        clearInterval(ping);
        stop = () => {};
      };
      req.signal.addEventListener("abort", () => stop());
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
