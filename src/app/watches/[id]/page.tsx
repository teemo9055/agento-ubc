"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { WatchCard, type WatchView } from "@/components/Watches";

/** One watch: every check it made, what it read, what it cost, and the job behind each. */
export default function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [w, setW] = useState<WatchView | null | undefined>(undefined);
  const load = () =>
    fetch(`/api/watches/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setW)
      .catch(() => setW(null));
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (w === null) return <p className="pt-16 text-center text-sm text-ink-2">No such watch.</p>;
  if (!w) return <div className="mx-auto h-64 max-w-3xl animate-pulse rounded-2xl bg-line/50 motion-reduce:animate-none" aria-busy="true" />;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href={`/runs/${w.fromRun}`} className="inline-flex min-h-8 items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <Icon name="back" size={15} /> The job it watches
      </Link>
      <WatchCard w={w} onStop={() => void fetch(`/api/watches/${w.id}`, { method: "DELETE" }).then(load)} />
      <ol className="space-y-1.5" aria-label="Checks" data-testid="watch-timeline">
        {[...w.checks].reverse().map((c, i) => (
          <li key={c.at} className="flex items-baseline justify-between gap-3 rounded-xl border border-line bg-panel px-3.5 py-2 text-[13px]">
            <span className="min-w-0">
              <span className="num text-ink-3">#{w.checks.length - i} · {new Date(c.at).toLocaleString()}</span>{" "}
              <span className={c.met ? "font-semibold text-warn-ink" : c.failed ? "text-bad" : "text-ink"}>{c.failed ? `Didn't deliver: ${c.failed}` : `Read ${typeof c.value === "object" ? JSON.stringify(c.value) : String(c.value)}${c.met ? " · condition met" : ""}`}</span>
            </span>
            <span className="num shrink-0 text-ink-2">
              ${c.cost.toFixed(4)}
              {c.job && (
                <Link href={`/runs/${c.job}`} className="ml-2 underline underline-offset-2">
                  job
                </Link>
              )}
            </span>
          </li>
        ))}
        {!w.checks.length && <li className="text-[13px] text-ink-2">The first check runs within a minute.</li>}
      </ol>
    </div>
  );
}
