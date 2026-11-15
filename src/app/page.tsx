"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AgentIcon } from "@/components/AgentIcon";
import { Spinner } from "@/components/ui";
import { useAgentTheme } from "@/components/useRun";
import { useRuns } from "@/components/runsStore";
import { NotifyToggle } from "@/components/AppShell";
import { Icon } from "@/components/Icon";
import { useTransitionNav } from "@/components/transitions";
import { fmt } from "@/lib/money";
import { THEMES } from "@/lib/themes";
import type { RunSummary } from "@/lib/summary";
import type { AgentId } from "@/lib/types";
import { moodFor } from "@/lib/outfit";

type Folder = "all" | AgentId;
type Section = "needs" | "chats" | "running" | "drafts" | "finished";

const SECTIONS: { key: Section; title: string; match: (r: RunSummary) => boolean }[] = [
  { key: "needs", title: "Needs you", match: (r) => r.needsYou > 0 },
  { key: "chats", title: "Exploring", match: (r) => r.status === "exploring" },
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

const TAG = "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-semibold";

function StatusPill({ r }: { r: RunSummary }) {
  if (r.planning)
    return (
      <span className={`${TAG} bg-agent-soft text-agent-ink`}>
        <Spinner /> Planning
      </span>
    );
  if (r.status === "exploring")
    return (
      <span className={`${TAG} bg-agent-soft text-agent-ink`}>
        {r.thinking ? <Spinner /> : null} {r.thinking ? "Thinking" : "Chatting"}
      </span>
    );
  if (r.needsYou > 0)
    return (
      <span className={`${TAG} border border-warn bg-warn/15 text-warn-ink`}>
        <span aria-hidden className="h-1.5 w-1.5 border border-warn-ink bg-warn" /> Needs you
      </span>
    );
  if (r.status === "running" || r.status === "funding")
    return (
      <span className={`${TAG} bg-agent-soft text-agent-ink`}>
        <Spinner /> {r.status === "funding" ? "Funding" : "Running"}
      </span>
    );
  if (r.status === "done")
    return (
      <span className={`${TAG} bg-good/10 text-good`}>
        <Icon name="check" size={12} stroke={2.6} /> Done
      </span>
    );
  if (r.status === "cancelled") return <span className={`${TAG} bg-[#f1f0ec] text-ink-2`}>Cancelled</span>;
  return <span className={`${TAG} bg-[#f1f0ec] text-ink-2`}>Draft</span>;
}

function JobCard({ r }: { r: RunSummary }) {
  const nav = useTransitionNav();
  const pct = r.stepsTotal ? (r.stepsDone / r.stepsTotal) * 100 : 0;
  const live = r.status === "running" || r.status === "funding";
  return (
    <motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} data-agent={r.agent}>
      <Link
        href={`/runs/${r.id}`}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          nav(`/runs/${r.id}`, { waitForPage: true });
        }}
        className={`pix-lift pressable group block rounded-2xl border bg-panel p-4 ${r.needsYou ? "border-warn" : "border-line"}`}
        data-testid={`job-${r.id}`}
      >
        <div className="flex items-start gap-3">
          <span style={{ viewTransitionName: `mascot-${r.id}` }}>
            <AgentIcon agent={r.agent} size={40} outfit={r.outfit} mood={moodFor(r.status, r.needsYou)} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink-3">
              <span className="font-semibold text-agent-ink">{THEMES[r.agent].name}</span>
              <span>· {r.mode === "live" ? "Arc testnet" : "demo"}</span>
              {r.planner === "ai" && <span>· AI plan</span>}
              <span>· {ago(r.finishedAt ?? r.createdAt)}</span>
            </div>
            <div className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-snug" style={{ viewTransitionName: `task-${r.id}` }}>
              {r.task}
            </div>
          </div>
          <StatusPill r={r} />
        </div>

        {live || r.needsYou ? (
          <div className="mt-3">
            <div className="flex justify-between text-[12px] text-ink-2">
              <span>{r.activeStep ?? "Starting"}</span>
              <span className="num">
                {r.stepsDone}/{r.stepsTotal} steps
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-[2px] bg-[#f1f0ec]">
              <motion.div className="h-full rounded-[2px] bg-agent" animate={{ width: `${pct}%` }} transition={{ duration: 0.5 }} />
            </div>
          </div>
        ) : r.headline ? (
          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-2">{r.headline}</p>
        ) : r.status === "exploring" && r.lastMessage ? (
          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-2">{r.lastMessage}</p>
        ) : r.move ? (
          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-2">Move: {r.move}</p>
        ) : null}

        <div className="num mt-3 flex items-center justify-between border-t border-[#f1f0ec] pt-2.5 text-[12px] text-ink-3">
          <span>
            {r.status === "exploring" ? (
              "Nothing spent while exploring"
            ) : (
              <>
                {r.status === "draft" ? "Quoted" : "Spent"} <b className="font-semibold text-ink">{fmt(r.status === "draft" ? r.approved : r.spent)}</b>
                {r.status !== "draft" && <> / {fmt(r.approved)}</>} USDC
              </>
            )}
          </span>
          {r.refunded && BigInt(r.refunded) > 0n ? (
            <span className="text-good">{fmt(r.refunded)} returned</span>
          ) : (
            <span className="reveal inline-flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              Open <Icon name="arrow" size={13} />
            </span>
          )}
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
  const { runs, connection } = useRuns();
  const search = useRef<HTMLInputElement>(null);
  useAgentTheme(folder === "all" ? "inso" : folder);


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

  const needs = visible.filter((r) => r.needsYou > 0);
  const showNeeds = needs.length > 0 && (!status || status === "needs");

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="font-pixel text-[30px] leading-tight sm:text-[34px]">{folder === "all" ? "Your jobs" : `${THEMES[folder].name} jobs`}</h1>
          <p className="mt-1 text-[15px] text-ink-2">{folder === "all" ? "Everything your agents are doing, in one place." : THEMES[folder].tagline}</p>
        </div>
        <div className="flex items-center gap-2">
          {connection === "reconnecting" && (
            <span className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-warn bg-warn/15 px-3 text-[13px] text-warn-ink" role="status">
              <Spinner /> Reconnecting
            </span>
          )}
          <NotifyToggle />
        </div>
      </div>

      <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-panel sm:grid-cols-4">
        {tiles.map((t, i) => (
          <div key={t.label} className={`px-5 py-3 ${i % 2 ? "border-l" : ""} ${i > 1 ? "border-t sm:border-t-0" : ""} ${i === 2 ? "sm:border-l" : ""} border-line`}>
            <dt className={`text-[12px] ${t.warn ? "font-medium text-warn-ink" : "text-ink-3"}`}>{t.label}</dt>
            <dd className={`num mt-0.5 text-[22px] font-semibold ${t.label === "Returned to you" ? "text-good" : ""}`}>
              {t.value}
              {t.unit && <span className="ml-1 text-[12px] font-medium text-ink-3">{t.unit}</span>}
            </dd>
          </div>
        ))}
      </dl>

      {showNeeds && (
        <section aria-label="Needs you" className="overflow-hidden rounded-2xl border-[1.5px] border-ink bg-warn-soft shadow-[3px_3px_0_0_var(--color-warn)]">
          <h2 className="flex flex-wrap items-center gap-2.5 border-b border-[#f1e3ba] px-4 py-3.5 text-[15px] font-semibold sm:px-5">
            <span aria-hidden className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border-[1.5px] border-ink bg-warn font-pixel text-[12px]">
              !
            </span>
            Needs you <span className="num font-medium text-warn-ink">· {needs.length} {needs.length === 1 ? "decision" : "decisions"}</span>
            <span className="ml-auto hidden text-[12px] font-normal text-warn-ink sm:inline">Other steps keep running while these wait</span>
          </h2>
          <ul>
            <AnimatePresence initial={false}>
              {needs.map((r) => (
                <motion.li key={r.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} data-agent={r.agent} className="border-b border-[#f1e3ba] last:border-0">
                  <Link href={`/runs/${r.id}`} className="pressable flex flex-wrap items-center gap-4 px-4 py-4 sm:px-5" data-testid={`needs-${r.id}`}>
                    <span className="nudge inline-flex">
                      <AgentIcon agent={r.agent} size={44} outfit={r.outfit} mood="alert" />
                    </span>
                    <div className="min-w-0 flex-[999_1_280px]">
                      <div className="text-[12px] text-ink-3">
                        <b className="font-semibold text-agent-ink">{THEMES[r.agent].name}</b> · {r.mode === "live" ? "Arc testnet" : "demo"} · step {Math.min(r.stepsDone + 1, r.stepsTotal)} of {r.stepsTotal}
                      </div>
                      <div className="truncate text-[15px] font-semibold">{r.task}</div>
                      <div className="text-[13px] text-ink-2">{r.activeStep ? `${r.activeStep} is waiting for your decision.` : "Waiting for your decision."}</div>
                    </div>
                    <span className="pix-press inline-flex h-10 items-center gap-1.5 rounded-lg border-[1.5px] border-ink bg-agent px-4 text-[13px] font-semibold text-agent-on">
                      Review <Icon name="arrow" size={14} stroke={2.2} />
                    </span>
                  </Link>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <nav aria-label="Folders" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:pb-0">
          {folders.map((f) => {
            const on = folder === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setParam("folder", f.key === "all" ? null : f.key)}
                aria-current={on ? "page" : undefined}
                data-agent={f.key === "all" ? undefined : f.key}
                title={f.sub}
                className={`pressable tap inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors ${on ? "border-ink bg-ink text-white" : "border-line bg-panel text-ink hover:border-ink"}`}
              >
                <span aria-hidden className={`h-2 w-2 rounded-[2px] ${f.key === "all" ? (on ? "bg-white" : "bg-ink") : "bg-agent"}`} />
                {f.label}
                <span className="num opacity-70">{count(f.key)}</span>
              </button>
            );
          })}
        </nav>
        <div className="ring-agent flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-line bg-panel px-3 sm:max-w-xs">
          <Icon name="search" size={15} className="text-ink-3" />
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
        <div className="flex gap-1 overflow-x-auto rounded-[9px] bg-[#f1f0ec] p-[3px]" role="tablist" aria-label="Status">
          {[{ key: null, title: "All" }, ...SECTIONS.map((s) => ({ key: s.key, title: s.key === "drafts" ? "Drafts" : s.title }))].map((s) => (
            <button
              key={s.title}
              role="tab"
              aria-selected={status === s.key}
              onClick={() => setParam("status", s.key)}
              className={`pressable shrink-0 rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition-colors ${status === s.key ? "bg-panel text-ink shadow-[0_1px_2px_rgb(11_11_11/0.12)]" : "text-ink-2 hover:text-ink"}`}
            >
              {s.title}
            </button>
          ))}
        </div>
      </div>

      {!runs && (
        <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-2xl bg-line/60 motion-reduce:animate-none" />
          ))}
        </div>
      )}

      {runs && visible.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[#d5d4ce] bg-panel/60 p-10 text-center">
          <div className="mx-auto flex w-fit gap-2">
            {(Object.keys(THEMES) as AgentId[]).map((a) => (
              <AgentIcon key={a} agent={a} size={34} />
            ))}
          </div>
          <div className="mt-4 font-semibold">{q ? "No jobs match that search" : "No jobs here yet"}</div>
          <p className="mt-1 text-sm text-ink-2">Bring a task. The agent prices it before it spends anything.</p>
          <Link
            href={folder === "all" ? "/new" : `/new?agent=${folder}`}
            className="pix-press mt-4 inline-flex h-10 items-center rounded-lg border-[1.5px] border-ink bg-agent px-4 text-sm font-semibold text-agent-on"
          >
            Start a job
          </Link>
        </div>
      )}

      {runs &&
        SECTIONS.filter((s) => s.key !== "needs" && (!status || s.key === status)).map((s) => {
          const items = visible.filter(s.match);
          if (!items.length) return null;
          return (
            <section key={s.key} aria-label={s.title}>
              <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
                {s.title} <span className="num">· {items.length}</span>
              </h2>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <AnimatePresence initial={false}>
                  {items.map((r) => (
                    <JobCard key={r.id} r={r} />
                  ))}
                </AnimatePresence>
              </ul>
            </section>
          );
        })}
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
