"use client";
import type { Run } from "@/lib/types";
import { LineChart, SERIES_COLORS, type Series } from "./LineChart";

type Pt = { t: number; p: number };
type Ev = { title: string; contracts: { symbol: string; label: string }[] };

const feedOf = (run: Run, product: string) => Object.entries(run.feed ?? {}).filter(([, v]) => v.product === product);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const signed = (x: number, f: (v: number) => string) => `${x >= 0 ? "+" : "−"}${f(Math.abs(x))}`;

function InsoWidget({ run }: { run: Run }) {
  const names: Record<string, string> = {};
  for (const [, v] of feedOf(run, "markets.search"))
    for (const e of v.data as Ev[]) for (const c of e.contracts) names[c.symbol] = `${e.title} · ${c.label}`;
  const series: Series[] = feedOf(run, "markets.history")
    .filter(([k]) => k.startsWith("history:"))
    .slice(0, 3)
    .map(([k, v], i) => {
      const sym = k.split(":")[1];
      return { id: sym, name: names[sym] ?? sym, color: SERIES_COLORS[i], points: v.data as Pt[] };
    });
  const analysis = (run.deliverable?.data as { markets?: { symbol: string; event: string; label: string; stats: { first: number; last: number; change: number; trend: string; biggestJump: number } | null; flow: { buys: number; sells: number } | null }[] })?.markets;

  return (
    <div>
      <div className="mb-1 text-[13px] font-semibold">YES odds over time</div>
      <LineChart series={series} format={pct} domain={[0, 1]} label="Prediction market odds over time" />
      {analysis && (
        <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] text-[12.5px] sm:min-w-0">
          <thead className="text-left text-[11px] uppercase tracking-wide text-ink-3">
            <tr>
              <th className="py-1.5 font-medium">Market</th>
              <th className="py-1.5 text-right font-medium">Now</th>
              <th className="py-1.5 text-right font-medium">Move</th>
              <th className="hidden py-1.5 text-right font-medium sm:table-cell">Biggest jump</th>
              <th className="py-1.5 text-right font-medium">Trend</th>
              <th className="hidden py-1.5 text-right font-medium sm:table-cell">Buy / sell flow</th>
            </tr>
          </thead>
          <tbody>
            {analysis.map((m) => (
              <tr key={m.symbol} className="border-t border-line">
                <td className="max-w-[220px] truncate py-1.5">
                  {m.event} <span className="text-ink-3">· {m.label}</span>
                </td>
                <td className="num py-1.5 text-right">{m.stats ? pct(m.stats.last) : "—"}</td>
                <td className="num py-1.5 text-right">{m.stats ? `${signed(m.stats.change * 100, (v) => v.toFixed(0))} pts` : "—"}</td>
                <td className="num hidden py-1.5 text-right sm:table-cell">{m.stats ? `${Math.round(m.stats.biggestJump * 100)} pts` : "—"}</td>
                <td className="py-1.5 text-right">{m.stats?.trend ?? "—"}</td>
                <td className="num hidden py-1.5 text-right sm:table-cell">{m.flow ? `${m.flow.buys.toFixed(0)} / ${m.flow.sells.toFixed(0)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

function TradoWidget({ run }: { run: Run }) {
  const hourly = feedOf(run, "spot.candles").filter(([k]) => k.endsWith(":1hr"));
  const signals = (run.deliverable?.data as { signals?: { symbol: string; ticker: string; trend: string; change24h: number; change7d: number; dailyVol: number }[] })?.signals;
  const money = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(v < 10 ? 3 : 1)}`);
  return (
    <div className="space-y-5">
      {hourly.length === 0 && <div className="flex h-[220px] items-center justify-center text-sm text-ink-3">Waiting for candles…</div>}
      {hourly.map(([k, v]) => {
        const sym = k.split(":")[1];
        const pts = (v.data as Pt[]).slice(-72);
        const sig = signals?.find((s) => s.symbol === sym);
        return (
          <div key={k}>
            <div className="mb-1 flex items-baseline justify-between text-[13px]">
              <span className="font-semibold">{sym.replace("usd", "").toUpperCase()} · last 72h</span>
              {sig && (
                <span className="num text-ink-2">
                  {sig.trend} · 24h {signed(sig.change24h * 100, (x) => x.toFixed(1))}% · 7d {signed(sig.change7d * 100, (x) => x.toFixed(1))}%
                </span>
              )}
            </div>
            <LineChart series={[{ id: sym, name: sym, color: SERIES_COLORS[0], points: pts }]} format={money} label={`${sym} price, hourly`} />
          </div>
        );
      })}
    </div>
  );
}

type Place = { name: string; lat: number; lon: number };

function TravoWidget({ run }: { run: Run }) {
  const places = feedOf(run, "places.geocode").map(([k, v]) => ({ k, p: v.data as Place | null })).filter((x) => x.p) as { k: string; p: Place }[];
  const route = feedOf(run, "routes.drive")[0]?.[1].data as { path: [number, number][]; distanceKm: number; hours: number } | undefined;
  const days = (run.deliverable?.data as { days?: { day: number; from: string; to: string; hours: number; km: number }[] })?.days;
  const pts: [number, number][] = [...(route?.path ?? []), ...places.map((x) => [x.p.lon, x.p.lat] as [number, number])];
  if (pts.length === 0) return <div className="flex h-[260px] items-center justify-center text-sm text-ink-3">Waiting for places…</div>;
  const W = 640;
  const H = 300;
  const lats = pts.map((p) => p[1]);
  const k = Math.cos(((Math.min(...lats) + Math.max(...lats)) / 2) * (Math.PI / 180));
  const xs = pts.map((p) => p[0] * k);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...lats), Math.max(...lats)];
  const s = Math.min((W - 60) / Math.max(1e-6, x1 - x0), (H - 50) / Math.max(1e-6, y1 - y0));
  const px = (lon: number, lat: number) => [30 + (lon * k - x0) * s + ((W - 60) - (x1 - x0) * s) / 2, 25 + (y1 - lat) * s + ((H - 50) - (y1 - y0) * s) / 2];
  const d = route?.path.map((p, i) => `${i ? "L" : "M"}${px(p[0], p[1]).map((n) => n.toFixed(1)).join(",")}`).join("");
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[13px]">
        <span className="font-semibold">Route</span>
        {route && (
          <span className="num text-ink-2">
            {Math.round(route.distanceKm)} km · {route.hours.toFixed(1)} h driving
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-line bg-surface" role="img" aria-label="Route map">
        {d && <path d={d} fill="none" stroke="var(--color-s1)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
        {places.map(({ k: key, p }, i) => {
          const [cx, cy] = px(p.lon, p.lat);
          return (
            <g key={key}>
              <circle cx={cx} cy={cy} r={6} fill={i === 0 || i === places.length - 1 ? "var(--color-ink)" : "var(--color-panel)"} stroke="var(--color-ink)" strokeWidth={2} />
              <text x={cx + 10} y={cy + 4} fontSize={12} fill="var(--color-ink)" stroke="var(--color-surface)" strokeWidth={3} paintOrder="stroke">
                {p.name}
              </text>
            </g>
          );
        })}
      </svg>
      {days && (
        <ol className="mt-3 grid gap-2 sm:grid-cols-2">
          {days.map((x) => (
            <li key={x.day} className="rounded-lg border border-line px-3 py-2 text-[12.5px]">
              <span className="font-semibold">Day {x.day}</span> · {x.from} → {x.to}
              <span className="num block text-ink-3">
                {Math.round(x.km)} km · {x.hours.toFixed(1)} h
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function AgentWidget({ run }: { run: Run }) {
  if (run.agent === "inso") return <InsoWidget run={run} />;
  if (run.agent === "trado") return <TradoWidget run={run} />;
  return <TravoWidget run={run} />;
}
