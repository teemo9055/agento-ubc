"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AgentIcon } from "@/components/AgentIcon";
import { Spinner } from "@/components/ui";
import { useAgentTheme } from "@/components/useRun";
import { fmt } from "@/lib/money";
import { THEMES } from "@/lib/themes";
import type { RunSummary } from "@/lib/summary";
import type { AgentId } from "@/lib/types";
import { moodFor } from "@/lib/outfit";

type Folder = "all" | AgentId;
type Section = "needs" | "running" | "drafts" | "finished";

const SECTIONS: { key: Section; title: string; match: (r: RunSummary) => boolean }[] = [
  { key: "needs", title: "Needs you", match: (r) => r.needsYou > 0 },
  { key: "running", title: "Running", match: (r) => (r.status === "running" || r.status === "funding") && r.needsYou === 0 },
  { key: "drafts", title: "Drafts awaiting approval", match: (r) => r.status === "draft" },
  { key: "finished", title: "Finished", match: (r) => r.status === "done" || r.status === "cancelled" },
];

function ago(iso?: string) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function StatusPill({ r }: { r: RunSummary }) {
  if (r.needsYou > 0) return <span className="rounded-full border border-warn bg-warn/15 px-2 py-0.5 text-[11px] font-medium text-[#7a5000]">! Needs you</span>;
  if (r.status === "running" || r.status === "funding")
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-agent/40 bg-agent-soft px-2 py-0.5 text-[11px] font-medium text-agent">
        <Spinner /> {r.status === "funding" ? "Funding" : "Running"}
      </span>
    );
  if (r.status === "done") return <span className="rounded-full border border-good/40 bg-good/5 px-2 py-0.5 text-[11px] font-medium text-good">✓ Done</span>;
  if (r.status === "cancelled") return <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-ink-3">– Cancelled</span>;
  return <span className="rounded-full border border-line bg-panel px-2 py-0.5 text-[11px] font-medium text-ink-2">○ Draft</span>;
}

function JobCard({ r }: { r: RunSummary }) {
  const pct = r.stepsTotal ? (r.stepsDone / r.stepsTotal) * 100 : 0;
  const live = r.status === "running" || r.status === "funding";
  return (
    <motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} data-agent={r.agent}>
      <Link
        href={`/runs/${r.id}`}
        className={`pix-lift group block rounded-2xl border bg-panel p-4 ${r.needsYou ? "border-warn" : "border-line"}`}
        data-testid={`job-${r.id}`}
      >
        <div className="flex items-start gap-3">
          <AgentIcon agent={r.agent} size={40} outfit={r.outfit} mood={moodFor(r.status, r.needsYou)} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-3">
              <span className="font-medium text-agent">{THEMES[r.agent].name}</span>
              <span>· {r.mode === "live" ? "Arc testnet" : "demo"}</span>
              {r.planner === "ai" && <span>· AI plan</span>}
              <span>· {ago(r.finishedAt ?? r.createdAt)}</span>
            </div>
            <div className="mt-0.5 line-clamp-2 font-medium leading-snug">{r.task}</div>
          </div>
          <StatusPill r={r} />
        </div>

        {live || r.needsYou ? (
          <div className="mt-3">
            <div className="flex justify-between text-[11.5px] text-ink-3">
              <span>{r.activeStep ?? "Starting"}</span>
              <span className="num">
                {r.stepsDone}/{r.stepsTotal} steps
              </span>
            </div>
            <div className="mt-1 h-1 pix-bar overflow-hidden bg-line">
              <motion.div className="h-full rounded-full bg-agent" animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }} />
            </div>
          </div>
        ) : r.headline ? (
          <p className="mt-2 line-clamp-2 text-[12.5px] text-ink-2">{r.headline}</p>
        ) : null}

        <div className="num mt-3 flex items-center justify-between border-t border-line pt-2 text-[12px] text-ink-3">
          <span>
            {r.status === "draft" ? "Quoted" : "Spent"} <b className="font-semibold text-ink">{fmt(r.status === "draft" ? r.approved : r.spent)}</b>
            {r.status !== "draft" && <> / {fmt(r.approved)}</>} USDC
          </span>
          {r.refunded && BigInt(r.refunded) > 0n ? <span>{fmt(r.refunded)} returned</span> : <span className="opacity-0 transition-opacity group-hover:opacity-100">Open →</span>}
        </div>
      </Link>
    </motion.li>
  );
}

function Dashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const folder = (params.get("folder") as Folder) ?? "all";
  const status = params.get("status") as Section | null;
  const [q, setQ] = useState(params.get("q") ?? "");
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const search = useRef<HTMLInputElement>(null);
  useAgentTheme(folder === "all" ? "inso" : folder);

  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/runs", { cache: "no-store" })
        .then((r) => r.json())
        .then((x: RunSummary[]) => !stop && setRuns(x))
        .catch(() => {});
    load();
    const t = setInterval(load, 2500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea")) return;
      if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      }
      if (e.key.toLowerCase() === "n") router.push(folder === "all" ? "/new" : `/new?agent=${folder}`);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [router, folder]);

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace(`/?${p}`, { scroll: false });
  };

  const inFolder = useMemo(() => (runs ?? []).filter((r) => folder === "all" || r.agent === folder), [runs, folder]);
  const visible = useMemo(() => inFolder.filter((r) => !q || r.task.toLowerCase().includes(q.toLowerCase())), [inFolder, q]);
  const count = (f: Folder) => (runs ?? []).filter((r) => f === "all" || r.agent === f).length;
  const tiles = useMemo(() => {
    const live = inFolder.filter((r) => r.mode === "live");
    return [
      { label: "Running", value: String(inFolder.filter((r) => r.status === "running" || r.status === "funding").length) },
      { label: "Needs you", value: String(inFolder.filter((r) => r.needsYou > 0).length), warn: inFolder.some((r) => r.needsYou > 0) },
      { label: "Spent on Arc", value: fmt(live.reduce((a, r) => a + BigInt(r.spent), 0n)), unit: "USDC" },
      { label: "Returned to you", value: fmt(live.reduce((a, r) => a + BigInt(r.refunded ?? 0), 0n)), unit: "USDC" },
    ];
  }, [inFolder]);

  const folders: { key: Folder; label: string; sub: string }[] = [
    { key: "all", label: "All jobs", sub: "Every agent" },
    ...(Object.keys(THEMES) as AgentId[]).map((a) => ({ key: a, label: THEMES[a].name, sub: THEMES[a].domain })),
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="mb-2 hidden text-[11px] font-medium uppercase tracking-wide text-ink-3 lg:block">Folders</div>
        <nav aria-label="Folders" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:flex-col lg:overflow-visible">
          {folders.map((f) => {
            const on = folder === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setParam("folder", f.key === "all" ? null : f.key)}
                aria-current={on ? "page" : undefined}
                data-agent={f.key === "all" ? undefined : f.key}
                className={`relative flex shrink-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${on ? "bg-panel shadow-sm ring-1 ring-line" : "hover:bg-panel/70"}`}
              >
                {f.key === "all" ? (
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-[30%] bg-ink text-[13px] text-white" aria-hidden>
                    ▤
                  </span>
                ) : (
                  <AgentIcon agent={f.key} size={28} />
                )}
                <span className="pr-6">
                  <span className="block text-[13px] font-medium leading-tight">{f.label}</span>
                  <span className="hidden text-[11px] text-ink-3 lg:block">{f.sub}</span>
                </span>
                <span className="num absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-ink-3">{count(f.key)}</span>
              </button>
            );
          })}
        </nav>
        <Link
          href={folder === "all" ? "/new" : `/new?agent=${folder}`}
          className="pix-press mt-3 hidden h-9 items-center justify-center gap-2 rounded-xl border border-ink bg-agent text-sm font-medium text-white lg:flex"
        >
          + New job <kbd className="rounded border border-white/30 px-1 text-[10px]">N</kbd>
        </Link>
      </aside>

      <section className="min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{folder === "all" ? "Your jobs" : `${THEMES[folder].name} jobs`}</h1>
            <p className="mt-0.5 text-sm text-ink-2">{folder === "all" ? "Everything your agents are doing, in one place." : THEMES[folder].tagline}</p>
          </div>
          <Link href={folder === "all" ? "/new" : `/new?agent=${folder}`} className="inline-flex h-9 items-center rounded-xl bg-agent px-4 text-sm font-medium text-white lg:hidden">
            + New job
          </Link>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className={`rounded-2xl border bg-panel px-4 py-3 ${t.warn ? "border-warn" : "border-line"}`}>
              <div className="text-[11.5px] text-ink-3">{t.label}</div>
              <div className="num mt-0.5 text-xl font-semibold">
                {t.value}
                {t.unit && <span className="ml-1 text-[11px] font-normal text-ink-3">{t.unit}</span>}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <div className="ring-agent flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-line bg-panel px-3">
            <span className="text-ink-3" aria-hidden>
              ⌕
            </span>
            <input
              ref={search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onBlur={() => setParam("q", q || null)}
              placeholder="Search jobs"
              aria-label="Search jobs"
              className="w-full bg-transparent text-sm outline-none"
            />
            <kbd className="hidden rounded border border-line px-1 text-[10px] text-ink-3 sm:inline">/</kbd>
          </div>
          <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Status">
            {[{ key: null, title: "All" }, ...SECTIONS.map((s) => ({ key: s.key, title: s.key === "drafts" ? "Drafts" : s.title }))].map((s) => (
              <button
                key={s.title}
                role="tab"
                aria-selected={status === s.key}
                onClick={() => setParam("status", s.key)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors ${status === s.key ? "border-ink bg-ink text-white" : "border-line bg-panel text-ink-2 hover:border-ink/30"}`}
              >
                {s.title}
              </button>
            ))}
          </div>
        </div>

        {!runs && (
          <div className="mt-6 grid gap-3 sm:grid-cols-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-36 animate-pulse rounded-2xl bg-line/60 motion-reduce:animate-none" />
            ))}
          </div>
        )}

        {runs && visible.length === 0 && (
          <div className="mt-8 rounded-2xl border border-dashed border-line bg-panel/60 p-10 text-center">
            <div className="mx-auto flex w-fit gap-2">
              {(Object.keys(THEMES) as AgentId[]).map((a) => (
                <AgentIcon key={a} agent={a} size={34} className="float" />
              ))}
            </div>
            <div className="mt-4 font-medium">{q ? "No jobs match that search" : "No jobs here yet"}</div>
            <p className="mt-1 text-sm text-ink-2">Bring a task. The agent prices it before it spends anything.</p>
            <Link href={folder === "all" ? "/new" : `/new?agent=${folder}`} className="mt-4 inline-block rounded-xl bg-agent px-4 py-2 text-sm font-medium text-white">
              Start a job
            </Link>
          </div>
        )}

        {runs &&
          SECTIONS.filter((s) => !status || s.key === status).map((s) => {
            const items = visible.filter(s.match);
            if (!items.length) return null;
            return (
              <section key={s.key} className="mt-7" aria-label={s.title}>
                <h2 className={`mb-2 text-[12px] font-medium uppercase tracking-wide ${s.key === "needs" ? "text-[#7a5000]" : "text-ink-3"}`}>
                  {s.title} <span className="num">· {items.length}</span>
                </h2>
                <ul className="grid gap-3 sm:grid-cols-2">
                  <AnimatePresence initial={false}>
                    {items.map((r) => (
                      <JobCard key={r.id} r={r} />
                    ))}
                  </AnimatePresence>
                </ul>
              </section>
            );
          })}
      </section>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}
