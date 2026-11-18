"use client";
import { useEffect, useState } from "react";
import type { MoveAction } from "@/lib/types";

/** Reads a free sketch from the server; null until it arrives, undefined if it can't be read. */
function useSketch<T>(query: string | null): T | null | undefined {
  const [data, setData] = useState<T | null | undefined>(null);
  useEffect(() => {
    if (!query) return;
    let on = true;
    setData(null);
    fetch(`/api/sketch?${query}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => on && setData(j as T))
      .catch(() => on && setData(undefined));
    return () => {
      on = false;
    };
  }, [query]);
  return data;
}

const usd = (x: number) => `$${x.toLocaleString(undefined, { maximumFractionDigits: x < 10 ? 4 : x < 1000 ? 2 : 0 })}`;

/**
 * The trading agent's view: the coin's last three days with your price drawn across it, so
 * "buy at $1,800 or lower" is a line you can see the price approaching or not.
 */
export function PriceSketch({ action }: { action: Extract<MoveAction, { kind: "spot_order" }> }) {
  const d = useSketch<{ points: { t: number; p: number }[]; last: number | null }>(`kind=chart&symbol=${action.symbol}`);
  const coin = action.symbol.replace(/usd$/, "").toUpperCase();
  const W = 640;
  const H = 150;
  if (d === undefined) return null;
  const pts = d?.points ?? [];
  const lo = Math.min(action.limitPrice, ...pts.map((p) => p.p));
  const hi = Math.max(action.limitPrice, ...pts.map((p) => p.p));
  const pad = (hi - lo) * 0.12 || 1;
  const y = (v: number) => H - 8 - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - 16);
  const x = (i: number) => (pts.length > 1 ? (i / (pts.length - 1)) * W : 0);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.p).toFixed(1)}`).join("");
  const last = d?.last ?? null;
  const buy = action.side === "buy";
  // A buy goes through when the price is at or under your line; a sell when it is at or over it.
  const would = last != null && (buy ? last <= action.limitPrice : last >= action.limitPrice);
  const gap = last != null ? Math.abs(last - action.limitPrice) : 0;
  return (
    <section className="rounded-2xl border border-line bg-panel px-4 py-3" aria-label={`${coin} price and your price`} data-testid="price-sketch">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[13px] font-semibold">{coin} over the last three days</div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Your price: {usd(action.limitPrice)}</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label={`${coin} price with a line at ${usd(action.limitPrice)}`}>
        {path && <path d={path} fill="none" stroke="var(--color-ink)" strokeWidth={1.75} vectorEffect="non-scaling-stroke" />}
        <line x1={0} x2={W} y1={y(action.limitPrice)} y2={y(action.limitPrice)} stroke="var(--agent)" strokeWidth={1.5} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
        {pts.length > 0 && <circle cx={W - 3} cy={y(pts[pts.length - 1].p)} r={3.5} fill={would ? "var(--color-good)" : "var(--color-ink)"} />}
      </svg>
      <p className="num mt-1.5 text-[12.5px] text-ink-2" data-testid="price-sketch-note">
        {last == null
          ? "Reading the price…"
          : would
            ? `${coin} is at ${usd(last)}, already ${buy ? "at or under" : "at or over"} your price: it would ${buy ? "buy" : "sell"} right away.`
            : `${coin} is at ${usd(last)}. It ${buy ? "buys" : "sells"} only if the price ${buy ? "falls" : "rises"} ${usd(gap)} (${((gap / last) * 100).toFixed(1)}%) to your line; until then it waits.`}
      </p>
    </section>
  );
}

interface RouteData {
  stops: { asked: string; place: { name: string; lat: number; lon: number } | null }[];
  legs: { from: string; to: string; km: number; hours: number }[];
  hours: number;
  km: number;
}

/**
 * The trip agent's view while the trip is still being shaped: the stops in order and how the
 * driving falls into days at the hours you set. Rough distances, free; the job buys the real route.
 */
export function TripSketch({ action }: { action: Extract<MoveAction, { kind: "itinerary" }> }) {
  const d = useSketch<RouteData>(`kind=route&stops=${encodeURIComponent(action.stops.join("|"))}`);
  if (d === undefined) return null;
  // Legs fill each day up to the hours allowed; a leg longer than a day is split across days.
  const days: { day: number; parts: { label: string; hours: number }[] }[] = [];
  let left = action.hoursPerDay;
  let cur: { day: number; parts: { label: string; hours: number }[] } = { day: 1, parts: [] };
  for (const l of d?.legs ?? []) {
    let h = l.hours;
    while (h > 0.05) {
      if (left < 0.25) {
        days.push(cur);
        cur = { day: cur.day + 1, parts: [] };
        left = action.hoursPerDay;
      }
      const take = Math.min(h, left);
      cur.parts.push({ label: take < l.hours - 0.05 ? `${l.from} → ${l.to} (part)` : `${l.from} → ${l.to}`, hours: Math.round(take * 10) / 10 });
      h -= take;
      left -= take;
    }
  }
  if (cur.parts.length) days.push(cur);
  const missing = d?.stops.filter((s) => !s.place).map((s) => s.asked) ?? [];
  return (
    <section className="rounded-2xl border border-line bg-panel px-4 py-3" aria-label="The trip, day by day" data-testid="trip-sketch">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[13px] font-semibold">{action.stops.join(" → ")}</div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">At most {action.hoursPerDay} h a day</div>
      </div>
      {!d ? (
        <p className="mt-2 text-[12.5px] text-ink-3">Finding the stops…</p>
      ) : (
        <>
          <ol className="mt-2.5 space-y-1.5" data-testid="trip-days">
            {days.map((day) => {
              const total = day.parts.reduce((s, p) => s + p.hours, 0);
              return (
                <li key={day.day} className="flex items-center gap-2.5" data-testid="trip-day">
                  <span className="w-12 shrink-0 text-[12px] font-semibold text-ink-2">Day {day.day}</span>
                  <span className="relative h-6 flex-1 overflow-hidden rounded-md bg-line/50">
                    <span className="absolute inset-y-0 left-0 rounded-md bg-agent/80" style={{ width: `${Math.min(100, (total / action.hoursPerDay) * 100)}%` }} />
                    <span className="absolute inset-0 flex items-center truncate px-2 text-[12px] font-medium text-ink">{day.parts.map((p) => p.label).join(", ")}</span>
                  </span>
                  <span className="num w-12 shrink-0 text-right text-[12px] text-ink-2">{total.toFixed(1)} h</span>
                </li>
              );
            })}
          </ol>
          <p className="num mt-2 text-[12.5px] text-ink-3" data-testid="trip-sketch-note">
            About {d.km.toLocaleString()} km and {d.hours} hours of driving, so {days.length} day{days.length === 1 ? "" : "s"} at this pace. A rough estimate from the map; the job reads the real route.
            {missing.length ? ` Couldn't place: ${missing.join(", ")}.` : ""}
          </p>
        </>
      )}
    </section>
  );
}
