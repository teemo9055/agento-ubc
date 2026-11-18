import { NextRequest, NextResponse } from "next/server";
import * as gemini from "@/server/gemini";
import * as geo from "@/server/geo";

export const dynamic = "force-dynamic";

/**
 * Free data for the drawings shown while a job is taking shape: the recent price of a coin
 * (for an order at a price) and where a trip's stops are (for a rough picture of the days).
 * Rough on purpose: nothing here is paid for, and the job itself buys the exact figures.
 */
const cache = new Map<string, { at: number; body: unknown }>();
const km = (a: geo.Place, b: geo.Place) => {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const kind = q.get("kind");
  const key = req.nextUrl.search;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return NextResponse.json(hit.body);
  try {
    let body: unknown;
    if (kind === "chart") {
      const symbol = (q.get("symbol") ?? "").toLowerCase();
      if (!/^[a-z0-9]{5,12}$/.test(symbol)) return NextResponse.json({ error: "bad symbol" }, { status: 400 });
      const points = (await gemini.spotCandles(symbol, "1hr")).slice(-72);
      body = { symbol, points, last: points.at(-1)?.p ?? null };
    } else if (kind === "route") {
      const names = (q.get("stops") ?? "").split("|").map((s) => s.trim()).filter(Boolean).slice(0, 6);
      if (names.length < 2) return NextResponse.json({ error: "two stops or more" }, { status: 400 });
      const places: (geo.Place | null)[] = [];
      // One at a time: the free map service asks for no more than a request a second.
      for (const n of names) places.push(await geo.geocode(n).catch(() => null));
      const found = places.filter((p): p is geo.Place => Boolean(p));
      // Roads are longer than the straight line between two towns, by about a quarter on average.
      const legs = found.slice(1).map((p, i) => {
        const d = km(found[i], p) * 1.25;
        return { from: found[i].name, to: p.name, km: Math.round(d), hours: Math.round((d / 90) * 10) / 10 };
      });
      body = { stops: names.map((n, i) => ({ asked: n, place: places[i] })), legs, hours: Math.round(legs.reduce((s, l) => s + l.hours, 0) * 10) / 10, km: legs.reduce((s, l) => s + l.km, 0) };
    } else return NextResponse.json({ error: "unknown kind" }, { status: 400 });
    cache.set(key, { at: Date.now(), body });
    if (cache.size > 100) for (const [k, v] of cache) if (Date.now() - v.at > 60_000) cache.delete(k);
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ error: "couldn't read that right now" }, { status: 502 });
  }
}
