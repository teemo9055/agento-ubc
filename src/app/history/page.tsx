"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { fmt, sum } from "@/lib/money";
import { dateTime } from "@/lib/format";
import { THEMES } from "@/lib/themes";
import type { Run } from "@/lib/types";

export default function History() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  useEffect(() => {
    fetch("/api/runs")
      .then((r) => r.json())
      .then(setRuns);
  }, []);
  if (!runs) return <div className="text-ink-3">Loading…</div>;
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">History</h1>
      <p className="mt-1 text-sm text-ink-2">Jobs on this server, newest first.</p>
      {runs.length === 0 && <p className="mt-8 text-ink-3">No jobs yet.</p>}
      <ul className="mt-6 divide-y divide-line rounded-xl border border-line bg-panel">
        {runs.map((r) => (
          <li key={r.id}>
            <Link href={`/runs/${r.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-surface">
              <div className="min-w-0">
                <div className="truncate font-medium">{r.task}</div>
                <div className="text-[12px] text-ink-3">
                  {THEMES[r.agent].name} · {r.status} · {r.decisions.length} decisions · {dateTime(r.createdAt)}
                </div>
              </div>
              <div className="num shrink-0 text-right text-sm">
                {fmt(sum(r.lines.map((l) => l.actual)))}
                <span className="text-ink-3"> / {fmt(sum(r.lines.map((l) => l.approved)))}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
