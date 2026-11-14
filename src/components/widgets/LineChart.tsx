"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export interface Series {
  id: string;
  name: string;
  color: string;
  points: { t: number; p: number }[];
}

const H = 220;
const PAD = { l: 44, r: 16, t: 12, b: 26 };

/** Thin 2px lines, recessive grid, crosshair + tooltip, legend for 2+ series. */
export function LineChart({ series, format, domain, label }: { series: Series[]; format: (v: number) => string; domain?: [number, number]; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const all = series.flatMap((s) => s.points);
  const { x, y, t0, t1, ticks } = useMemo(() => {
    const ts = all.map((p) => p.t);
    const ps = all.map((p) => p.p);
    const t0 = Math.min(...ts);
    const t1 = Math.max(...ts);
    let [lo, hi] = domain ?? [Math.min(...ps), Math.max(...ps)];
    if (!domain) {
      const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1;
      lo -= pad;
      hi += pad;
    }
    const x = (t: number) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (w - PAD.l - PAD.r);
    const y = (p: number) => PAD.t + (1 - (p - lo) / Math.max(1e-9, hi - lo)) * (H - PAD.t - PAD.b);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));
    return { x, y, t0, t1, ticks };
  }, [all, domain, w]);

  if (all.length === 0) return <div className="flex h-[220px] items-center justify-center text-sm text-ink-3">Waiting for data…</div>;

  const near = hover == null ? null : series.map((s) => ({ s, pt: s.points.reduce((a, b) => (Math.abs(b.t - hover) < Math.abs(a.t - hover) ? b : a), s.points[0]) })).filter((n) => n.pt);
  const tfmt = (t: number) => new Date(t).toLocaleString([], t1 - t0 > 2 * 864e5 ? { month: "short", day: "numeric" } : { hour: "2-digit", minute: "2-digit" });

  return (
    <div ref={ref} className="relative w-full">
      {series.length >= 2 && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2" aria-label="Legend">
          {series.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-[2px] w-3 rounded" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <svg
        width={w}
        height={H}
        role="img"
        aria-label={label}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = e.clientX - r.left;
          setHover(t0 + ((px - PAD.l) / (w - PAD.l - PAD.r)) * (t1 - t0));
        }}
        onMouseLeave={() => setHover(null)}
        className="block"
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize={10.5} fill="var(--color-ink-3)" className="num">
              {format(v)}
            </text>
          </g>
        ))}
        <text x={PAD.l} y={H - 6} fontSize={10.5} fill="var(--color-ink-3)">
          {tfmt(t0)}
        </text>
        <text x={w - PAD.r} y={H - 6} textAnchor="end" fontSize={10.5} fill="var(--color-ink-3)">
          {tfmt(t1)}
        </text>
        {series.map((s) => (
          <path
            key={s.id}
            d={s.points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join("")}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {near && hover != null && (
          <g>
            <line x1={x(near[0].pt.t)} x2={x(near[0].pt.t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-ink-3)" strokeDasharray="3 3" />
            {near.map(({ s, pt }) => (
              <circle key={s.id} cx={x(pt.t)} cy={y(pt.p)} r={4} fill={s.color} stroke="var(--color-panel)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {near && hover != null && (
        <div
          className="pointer-events-none absolute top-8 z-10 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[11.5px] shadow-md"
          style={{ left: Math.min(w - 170, Math.max(0, x(near[0].pt.t) + 10)) }}
        >
          <div className="text-ink-3">{new Date(near[0].pt.t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
          {near.map(({ s, pt }) => (
            <div key={s.id} className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
              <span className="max-w-[110px] truncate text-ink-2">{s.name}</span>
              <span className="num ml-auto font-medium">{format(pt.p)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const SERIES_COLORS = ["var(--color-s1)", "var(--color-s2)", "var(--color-s3)"];
