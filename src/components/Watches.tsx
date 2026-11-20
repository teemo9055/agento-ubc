"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Run } from "@/lib/types";
import { perCheckUsd } from "@/lib/watchCost";
import { Button, Spinner } from "./ui";
import { post } from "./useRun";
import { toast } from "./Toaster";

type Every = "15m" | "1h" | "6h" | "1d";
export type WatchView = {
  id: string;
  title: string;
  every: Every;
  until: string;
  condition: { ref: string; op: string; value?: string | number };
  maxChecks: number;
  perCheckCapUsd: number;
  totalCapUsd: number;
  status: "active" | "triggered" | "stopped" | "expired" | "out_of_funds";
  checks: { at: string; value?: unknown; met: boolean; cost: number; job?: string; failed?: string }[];
  fromRun: string;
};

const EVERY: Record<Every, { label: string; ms: number }> = { "15m": { label: "every 15 minutes", ms: 900_000 }, "1h": { label: "every hour", ms: 3_600_000 }, "6h": { label: "every 6 hours", ms: 21_600_000 }, "1d": { label: "every day", ms: 86_400_000 } };
const STATUS: Record<WatchView["status"], string> = { active: "Watching", triggered: "It happened", stopped: "Stopped", expired: "Ended", out_of_funds: "Reached its total" };
const usd = (x: number) => `$${x > 0 && x < 0.01 ? x.toFixed(4) : x.toFixed(2)}`;
const show = (v: unknown) => (v === undefined ? "–" : typeof v === "object" ? JSON.stringify(v).slice(0, 40) : String(v));

/** The plain fields of each finished step's answer: what can be watched. */
function watchable(run: Run) {
  const out: { ref: string; label: string; value: unknown }[] = [];
  for (const p of run.phases.filter((x) => x.status === "done" && x.lineId)) {
    const r = run.results?.[p.id] as { data?: unknown; paid?: unknown } | undefined;
    const a = r && typeof r === "object" && "paid" in r ? r.data : r;
    const walk = (v: unknown, path: string, depth: number) => {
      if (depth > 2 || out.length > 30 || v == null) return;
      if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
        if (path) out.push({ ref: `$${p.id}.${path}`, label: `${p.label.replace(/^[^:]+: /, "")} · ${path.replace(/_/g, " ")}`, value: v });
        return;
      }
      if (typeof v === "object" && !Array.isArray(v)) for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 12)) walk(x, path ? `${path}.${k}` : k, depth + 1);
    };
    walk(a, "", 0);
  }
  return out;
}

/** "Watch this": something a finished job found, checked again on a schedule until a condition is met. */
export function WatchThis({ run }: { run: Run }) {
  const options = useMemo(() => watchable(run), [run]);
  const first = options.find((o) => typeof o.value === "number") ?? options[0];
  const [ref, setRef] = useState(first?.ref ?? "");
  const pick = options.find((o) => o.ref === ref);
  const numeric = typeof pick?.value === "number";
  const [op, setOp] = useState<string>(numeric ? "<=" : "changed");
  const [value, setValue] = useState(numeric ? String(pick?.value) : "");
  const [every, setEvery] = useState<Every>("1h");
  const [days, setDays] = useState(3);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<WatchView | null>(null);
  if (!options.length) return null;
  // Same sum the server caps each check at: only the steps this condition needs.
  const perCheck = perCheckUsd(run, ref);
  const checks = Math.min(500, Math.ceil((days * 86_400_000) / EVERY[every].ms));
  return (
    <section className="rounded-2xl border border-line bg-panel px-4 py-3" aria-label="Watch this" data-testid="watch-this">
      <h3 className="text-[15px] font-semibold">Watch this</h3>
      {made ? (
        <p className="mt-1 text-[13.5px] text-ink-2" data-testid="watch-made">
          Watching. <Link href={`/watches/${made.id}`} className="font-medium text-ink underline underline-offset-2">See its checks</Link>
        </p>
      ) : (
        <form
          className="mt-2 flex flex-wrap items-end gap-2 text-[13px]"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            post<WatchView>("/api/watches", { runId: run.id, ref, op, value: op === "changed" ? undefined : numeric && value !== "" ? Number(value) : value, every, days })
              .then((w) => {
                setMade(w);
                toast("Watching · you'll see it on your Jobs page", "good");
              })
              .catch((x) => toast((x as Error).message, "bad"))
              .finally(() => setBusy(false));
          }}
        >
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-ink-3">Tell me if</span>
            <select value={ref} onChange={(e) => setRef(e.target.value)} className="h-9 max-w-[260px] rounded-lg border border-line bg-surface px-2" data-testid="watch-ref">
              {options.map((o) => (
                <option key={o.ref} value={o.ref}>
                  {o.label} (now {show(o.value)})
                </option>
              ))}
            </select>
          </label>
          <select value={op} onChange={(e) => setOp(e.target.value)} aria-label="Condition" className="h-9 rounded-lg border border-line bg-surface px-2" data-testid="watch-op">
            {numeric && <option value="<=">drops to</option>}
            {numeric && <option value=">=">rises to</option>}
            <option value="changed">changes</option>
            <option value="==">becomes</option>
          </select>
          {op !== "changed" && <input value={value} onChange={(e) => setValue(e.target.value)} aria-label="Value" className="h-9 w-24 rounded-lg border border-line bg-surface px-2" data-testid="watch-value" />}
          <select value={every} onChange={(e) => setEvery(e.target.value as Every)} aria-label="How often" className="h-9 rounded-lg border border-line bg-surface px-2">
            {(Object.keys(EVERY) as Every[]).map((k) => (
              <option key={k} value={k}>
                {EVERY[k].label}
              </option>
            ))}
          </select>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="For how long" className="h-9 rounded-lg border border-line bg-surface px-2">
            {[1, 3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                for {d} day{d === 1 ? "" : "s"}
              </option>
            ))}
          </select>
          <Button type="submit" variant="agent" className="h-9" disabled={busy || !ref} data-testid="watch-start">
            {busy ? <Spinner /> : null} Watch it
          </Button>
          <p className="num w-full text-[12.5px] text-ink-3" data-testid="watch-cost">
            Each check about {usd(perCheck)} · at most {usd(perCheck * checks)} total ({checks} checks)
          </p>
        </form>
      )}
    </section>
  );
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${max === min ? 12 : 22 - ((v - min) / (max - min)) * 20}`).join(" ");
  return (
    <svg viewBox="0 0 100 24" className="h-6 w-full" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--agent)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** One watch as a card: what it watches, the values it read, money used, and Stop. */
export function WatchCard({ w, onStop }: { w: WatchView; onStop?: () => void }) {
  const spent = w.checks.reduce((a, c) => a + c.cost, 0);
  const nums = w.checks.map((c) => Number(c.value)).filter((n) => Number.isFinite(n));
  const last = [...w.checks].reverse().find((c) => !c.failed);
  return (
    <div className="flex flex-col gap-1.5 rounded-2xl border border-line bg-panel p-3.5" data-testid={`watch-${w.id}`} data-status={w.status}>
      <div className="flex items-center justify-between gap-2">
        <Link href={`/watches/${w.id}`} className="truncate text-[14px] font-semibold hover:underline">
          {w.title}
        </Link>
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${w.status === "triggered" ? "bg-warn/25 text-warn-ink" : w.status === "active" ? "bg-agent-soft text-agent-ink" : "bg-[#f1f0ec] text-ink-3"}`}>{STATUS[w.status]}</span>
      </div>
      <Spark values={nums} />
      <p className="num text-[12.5px] text-ink-2">
        Last: {show(last?.value)} · {w.checks.length} of {w.maxChecks} checks · {usd(spent)} of {usd(w.totalCapUsd)} used
      </p>
      {w.status === "active" && onStop && (
        <button type="button" onClick={onStop} className="self-start text-[12.5px] font-medium text-ink-2 underline underline-offset-2 hover:text-ink" data-testid={`watch-stop-${w.id}`}>
          Stop
        </button>
      )}
    </div>
  );
}

/** Watches on the home page, when there are any. */
export function WatchList() {
  const [list, setList] = useState<WatchView[] | null>(null);
  const load = () =>
    fetch("/api/watches")
      .then((r) => r.json())
      .then((b: { watches: WatchView[] }) => setList(b.watches))
      .catch(() => setList([]));
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!list?.length) return null;
  return (
    <section aria-label="Watches" data-testid="watch-list">
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-3">Watching</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((w) => (
          <WatchCard key={w.id} w={w} onStop={() => void fetch(`/api/watches/${w.id}`, { method: "DELETE" }).then(load)} />
        ))}
      </div>
    </section>
  );
}
