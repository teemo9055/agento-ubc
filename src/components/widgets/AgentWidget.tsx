"use client";
import type { Run } from "@/lib/types";
import { LineChart, SERIES_COLORS, type Series } from "./LineChart";

type Pt = { t: number; p: number };
type Ev = { title: string; contracts: { symbol: string; label: string }[] };

const feedOf = (run: Run, product: string) => Object.entries(run.feed ?? {}).filter(([, v]) => v.product === product);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const signed = (x: number, f: (v: number) => string) => `${x >= 0 ? "+" : "−"}${f(Math.abs(x))}`;

type CheckData = { check?: { text: string; stats: Record<string, unknown>[] } };

function OddsCharts({ run }: { run: Run }) {
  const names: Record<string, string> = {};
  for (const r of run.proposal?.research ?? []) if (r.args.symbol) names[r.args.symbol] = r.label;
  if (run.proposal?.action?.kind === "prediction_order") names[run.proposal.action.symbol] = run.proposal.action.label;
  const series: Series[] = feedOf(run, "markets.history")
    .filter(([k]) => k.startsWith("history:"))
    .slice(0, 3)
    .map(([k, v], i) => {
      const sym = k.split(":")[1];
      return { id: sym, name: names[sym] ?? sym, color: SERIES_COLORS[i], points: v.data as Pt[] };
    });
  if (!series.length) return null;
  return (
    <div>
      <div className="mb-1 text-[13px] font-semibold">YES odds over time</div>
      <LineChart series={series} format={pct} domain={[0, 1]} label="Prediction market odds over time" />
    </div>
  );
}

function SpotCharts({ run }: { run: Run }) {
  const feeds = feedOf(run, "spot.candles");
  const money = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(v < 10 ? 3 : 1)}`);
  if (!feeds.length) return null;
  return (
    <div className="space-y-5">
      {feeds.map(([k, v]) => {
        const [, sym, tf] = k.split(":");
        const pts = (v.data as Pt[]).slice(tf === "1day" ? -60 : -72);
        return (
          <div key={k}>
            <div className="mb-1 text-[13px] font-semibold">
              {sym.replace("usd", "").toUpperCase()} · {tf === "1day" ? "daily" : "last 72h"}
            </div>
            <LineChart series={[{ id: sym, name: sym, color: SERIES_COLORS[0], points: pts }]} format={money} label={`${sym} price`} />
          </div>
        );
      })}
    </div>
  );
}

function Tape({ run }: { run: Run }) {
  const tapes = feedOf(run, "markets.tape");
  if (!tapes.length) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {tapes.map(([k, v]) => {
        const ts = v.data as { size: number; side: string }[];
        const buys = ts.filter((t) => t.side === "buy").reduce((a, t) => a + t.size, 0);
        const sells = ts.filter((t) => t.side === "sell").reduce((a, t) => a + t.size, 0);
        const share = buys + sells ? buys / (buys + sells) : 0.5;
        return (
          <div key={k} className="rounded-lg border border-line p-3 text-[12.5px]">
            <div className="font-medium">Trade flow · {ts.length} trades</div>
            <div className="mt-2 flex h-2 overflow-hidden bg-line">
              <div className="bg-good" style={{ width: `${share * 100}%` }} />
              <div className="bg-bad/70" style={{ width: `${(1 - share) * 100}%` }} />
            </div>
            <div className="num mt-1 flex justify-between text-ink-3">
              <span>Buys {buys.toFixed(0)}</span>
              <span>Sells {sells.toFixed(0)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const STAT_LABEL: Record<string, string> = { first: "start", last: "now", change: "move", high: "high", low: "low", biggestJump: "biggest jump", trend: "trend", change24h: "24h", change7d: "7d", trades: "trades", buys: "buys", sells: "sells", km: "km", hours: "hours" };

function Findings({ run }: { run: Run }) {
  const c = (run.deliverable?.data as CheckData | undefined)?.check;
  if (!c) return null;
  const odds = (k: string) => ["first", "last", "high", "low"].includes(k);
  const fmtV = (k: string, v: unknown) => {
    if (typeof v !== "number") return String(v);
    if (k === "change" || k === "biggestJump") return `${signed(v * 100, (x) => x.toFixed(0))} pts`;
    if (k === "change24h" || k === "change7d") return signed(v * 100, (x) => `${x.toFixed(1)}%`);
    if (odds(k) && v <= 1) return pct(v);
    return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };
  return (
    <div className="rounded-lg border border-line p-3 text-[12.5px]">
      <div className="font-medium">{c.text}</div>
      {c.stats.map((s, i) => (
        <div key={i} className="mt-2">
          <div className="text-[12px] text-ink-3">{String(s.step)}</div>
          <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
            {Object.entries(s)
              .filter(([k, v]) => k !== "step" && v != null && STAT_LABEL[k])
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-ink-3">{STAT_LABEL[k]}</dt>
                  <dd className="num">{fmtV(k, v)}</dd>
                </div>
              ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

type Place = { name: string; lat: number; lon: number };

type RouteData = { path: [number, number][]; distanceKm: number; hours: number };

function RouteMap({ run }: { run: Run }) {
  const d0 = run.deliverable?.data as { days?: { day: number; from: string; to: string; hours: number; km: number; stay?: { name: string; where: string; website?: string }[] }[]; places?: Place[]; route?: RouteData; lookFor?: "hotel" | "charging" } | undefined;
  const places = (d0?.places ?? []).map((p, i) => ({ k: `${i}`, p }));
  const route = (feedOf(run, "routes.drive")[0]?.[1].data as RouteData | undefined) ?? d0?.route;
  const days = d0?.days;
  const pts: [number, number][] = [...(route?.path ?? []), ...places.map((x) => [x.p.lon, x.p.lat] as [number, number])];
  if (pts.length === 0) return null;
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
              {!x.stay?.length && days.some((d) => d.stay?.length) && <span className="mt-1.5 block border-t border-[#f1f0ec] pt-1.5 text-ink-3">{d0?.lookFor === "charging" ? "The map lists no chargers right here; plan to charge at the stop before." : "The map lists no places to stay right here; look in the nearest town."}</span>}
              {x.stay && x.stay.length > 0 && (
                <div className="mt-1.5 border-t border-[#f1f0ec] pt-1.5" data-testid="stay">
                  <span className="text-ink-3">{d0?.lookFor === "charging" ? "EV chargers in" : "Places to stay in"} {x.to}:</span>
                  <ul className="mt-0.5 space-y-0.5">
                    {x.stay.map((h) => (
                      <li key={h.name}>
                        {h.website ? (
                          <a href={h.website} target="_blank" rel="noreferrer" className="font-medium underline decoration-line underline-offset-2">
                            {h.name}
                          </a>
                        ) : (
                          <span className="font-medium">{h.name}</span>
                        )}
                        {h.where && <span className="text-ink-3"> · {h.where}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {days?.some((x) => x.stay?.length) && <p className="mt-2 text-[12px] text-ink-3">{d0?.lookFor === "charging" ? "Chargers from OpenStreetMap, closest first. Check plug type and availability before you go." : "A shortlist from OpenStreetMap, closest first. Nothing is booked; check prices and availability with the hotel."}</p>}
    </div>
  );
}

export function AgentWidget({ run }: { run: Run }) {
  const empty = !Object.keys(run.feed ?? {}).length && !run.deliverable;
  return (
    <div className="space-y-5">
      {empty && <div className="flex h-[200px] items-center justify-center text-sm text-ink-3">Waiting for the first data…</div>}
      <OddsCharts run={run} />
      <SpotCharts run={run} />
      <RouteMap run={run} />
      <Tape run={run} />
      <Findings run={run} />
    </div>
  );
}
