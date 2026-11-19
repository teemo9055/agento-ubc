"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Phase, Run } from "@/lib/types";
import { tally } from "@/server/verdict";
import { PhaseGraph } from "../PhaseGraph";

/** The job as it stood at time t, from what was stored: nothing new from the server. */
export function runAt(run: Run, t: number): Run {
  const phases: Phase[] = run.phases.map((p) => {
    const start = p.startedAt ? Date.parse(p.startedAt) : NaN;
    const end = p.endedAt ? Date.parse(p.endedAt) : NaN;
    const payments = p.payments.filter((x) => !x.at || Date.parse(x.at) <= t);
    if (!Number.isFinite(start) || start >= t) return { ...p, status: p.gap ? p.status : "planned", progress: 0, payments: [], finding: undefined, conflict: undefined, note: undefined, inputs: undefined };
    if (!Number.isFinite(end) || end > t) return { ...p, status: "active", progress: 0.5, payments, finding: undefined, conflict: undefined };
    return { ...p, payments };
  });
  const lines = run.lines.map((l) => {
    const p = phases.find((x) => x.lineId === l.id);
    const paid = (p?.payments ?? []).filter((x) => x.txState === "settled" && !x.refund).reduce((a, x) => a + BigInt(x.amount ?? 0), 0n);
    return { ...l, actual: (paid < BigInt(l.actual) ? paid : BigInt(l.actual)).toString() };
  });
  const finished = run.finishedAt && Date.parse(run.finishedAt) <= t;
  const at: Run = { ...run, phases, lines, status: finished ? run.status : "running", report: finished ? run.report : undefined, refunded: finished ? run.refunded : undefined };
  return { ...at, verdict: tally(at) };
}

const fmtT = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/**
 * A finished job, replayable: drag to see the graph as it was at any moment (what had started,
 * what it had found, what had been paid), or play it back at four times speed.
 */
export function Replay({ run }: { run: Run }) {
  const times = useMemo(() => {
    const ts = run.phases.flatMap((p) => [p.startedAt, p.endedAt, ...p.payments.map((x) => x.at)]).filter((x): x is string => Boolean(x)).map(Date.parse).filter(Number.isFinite);
    return ts.length ? { start: Math.min(...ts), end: Math.max(...ts, run.finishedAt ? Date.parse(run.finishedAt) : 0) } : null;
  }, [run]);
  const [t, setT] = useState<number | null>(null);
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  if (!times || times.end <= times.start) return <PhaseGraph phases={run.phases} lines={run.lines} simulated={run.mode === "demo"} run={run} />;
  const span = times.end - times.start;
  const now = t ?? times.end;
  const shown = t == null ? run : runAt(run, now);
  const marks = [
    ...run.phases.flatMap((p) => p.payments.filter((x) => x.at).map((x) => ({ at: Date.parse(x.at!), kind: "payment" as const }))),
    ...run.phases.filter((p) => p.conflict && p.endedAt).map((p) => ({ at: Date.parse(p.endedAt!), kind: "conflict" as const })),
    ...run.decisions.map((d) => ({ at: Date.parse(d.at), kind: "decision" as const })),
  ].filter((m) => m.at >= times.start && m.at <= times.end);
  const play = () => {
    cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const step = (x: number) => {
      const k = Math.min(1, ((x - t0) * 4) / Math.max(span, 1));
      setT(times.start + k * span);
      if (k < 1) raf.current = requestAnimationFrame(step);
      else setT(null);
    };
    setT(times.start);
    raf.current = requestAnimationFrame(step);
  };
  return (
    <div className="space-y-3">
      <PhaseGraph phases={shown.phases} lines={shown.lines} simulated={run.mode === "demo"} run={shown} />
      <div className="flex items-center gap-3 border-t border-[#f1f0ec] pt-3" data-testid="replay">
        <button type="button" onClick={play} className="pressable inline-flex h-8 shrink-0 items-center rounded-lg border border-ink px-2.5 text-[12.5px] font-semibold hover:bg-ink hover:text-white" data-testid="replay-play">
          ▶ Replay
        </button>
        <div className="relative flex-1">
          <input
            type="range"
            min={0}
            max={span}
            step={Math.max(1, Math.round(span / 200))}
            value={now - times.start}
            onChange={(e) => {
              cancelAnimationFrame(raf.current);
              const v = Number(e.target.value);
              setT(v >= span ? null : times.start + v);
            }}
            aria-label="Replay the job"
            aria-valuetext={`${fmtT(now - times.start)} of ${fmtT(span)}`}
            className="w-full accent-[var(--agent)]"
            data-testid="replay-scrubber"
          />
          <div className="pointer-events-none absolute inset-x-0 top-[-6px] h-1" aria-hidden>
            {marks.map((m, i) => (
              <span key={i} className={`absolute h-1.5 w-[3px] rounded-sm ${m.kind === "payment" ? "bg-[#2775ca]" : m.kind === "conflict" ? "bg-bad" : "bg-ink/40"}`} style={{ left: `${((m.at - times.start) / span) * 100}%` }} />
            ))}
          </div>
        </div>
        <span className="num w-20 shrink-0 text-right text-[12px] text-ink-3">
          {fmtT(now - times.start)} / {fmtT(span)}
        </span>
      </div>
    </div>
  );
}
