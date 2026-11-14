"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { AgentIcon } from "@/components/AgentIcon";
import { fmt, sum } from "@/lib/money";
import { dateTime, time } from "@/lib/format";
import { THEMES } from "@/lib/themes";
import type { Run } from "@/lib/types";

const GROUPS: { key: string; title: string; match: (r: Run) => boolean }[] = [
  { key: "needs", title: "Needs you", match: (r) => r.pendingReapprovals.length + r.pendingFailures.length > 0 },
  { key: "running", title: "Running", match: (r) => (r.status === "running" || r.status === "funding") && r.pendingReapprovals.length + r.pendingFailures.length === 0 },
  { key: "draft", title: "Drafts", match: (r) => r.status === "draft" },
  { key: "done", title: "Finished", match: (r) => r.status === "done" || r.status === "cancelled" },
];

const STATUS: Record<Run["status"], string> = { draft: "Draft", funding: "Funding", running: "Running", done: "Done", cancelled: "Cancelled" };

function Row({ r }: { r: Run }) {
  const [open, setOpen] = useState(false);
  const spent = sum(r.lines.map((l) => l.actual));
  const approved = sum(r.lines.map((l) => l.approved));
  return (
    <li data-agent={r.agent}>
      <div className="flex items-center gap-3 px-4 py-3">
        <AgentIcon agent={r.agent} size={34} />
        <Link href={`/runs/${r.id}`} className="min-w-0 flex-1">
          <div className="truncate font-medium hover:underline">{r.task}</div>
          <div className="text-[12px] text-ink-3">
            {THEMES[r.agent].name} · {STATUS[r.status]} · {r.mode === "live" ? "Arc testnet" : "demo"} · {dateTime(r.createdAt)}
          </div>
        </Link>
        <div className="num hidden shrink-0 text-right text-sm sm:block">
          {fmt(spent)}
          <span className="text-ink-3"> / {fmt(approved)}</span>
        </div>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="rounded-lg px-2 py-1 text-[12px] text-ink-2 hover:bg-ink/5">
          {r.decisions.length} decisions {open ? "▴" : "▾"}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ol initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-line bg-surface/60 px-4 text-[12.5px]">
            {r.decisions.length === 0 && <li className="py-2 text-ink-3">No decisions yet.</li>}
            {r.decisions.map((d) => (
              <li key={d.id} className="flex flex-wrap gap-x-2 py-1.5 first:pt-2.5 last:pb-2.5">
                <span className="num text-ink-3">{time(d.at)}</span>
                <span className="font-medium">{d.what}</span>
                <span className="text-ink-2">
                  · {d.outcome.replace("_", " ")} by {d.by}
                </span>
              </li>
            ))}
          </motion.ol>
        )}
      </AnimatePresence>
    </li>
  );
}

export default function History() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  useEffect(() => {
    const load = () =>
      fetch("/api/runs")
        .then((r) => r.json())
        .then(setRuns);
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">History</h1>
      <p className="mt-1 text-sm text-ink-2">Every job on this server, with its decision log.</p>
      {!runs && (
        <div className="mt-6 space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-line/60 motion-reduce:animate-none" />
          ))}
        </div>
      )}
      {runs?.length === 0 && (
        <div className="mt-10 rounded-2xl border border-dashed border-line p-10 text-center">
          <div className="font-medium">No jobs yet</div>
          <p className="mt-1 text-sm text-ink-2">Bring a task and the agent prices it before spending anything.</p>
          <Link href="/" className="mt-4 inline-block rounded-lg bg-ink px-4 py-2 text-sm text-white">
            New job
          </Link>
        </div>
      )}
      {runs &&
        GROUPS.map((g) => {
          const items = runs.filter(g.match);
          if (!items.length) return null;
          return (
            <section key={g.key} className="mt-8">
              <h2 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-ink-3">
                {g.title} <span className="num">· {items.length}</span>
              </h2>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
                {items.map((r) => (
                  <Row key={r.id} r={r} />
                ))}
              </ul>
            </section>
          );
        })}
    </div>
  );
}
