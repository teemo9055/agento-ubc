"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { AgentIcon } from "@/components/AgentIcon";
import { Button, Spinner } from "@/components/ui";
import { useAgentTheme } from "@/components/useRun";
import { useRuns } from "@/components/runsStore";
import { Icon } from "@/components/Icon";
import { useTransitionNav } from "@/components/transitions";
import { toast } from "@/components/Toaster";
import { AGENT_LIST, THEMES } from "@/lib/themes";
import { openedMap } from "@/lib/opened";
import { Band, Card } from "@/components/JobCard";
import type { RunSummary } from "@/lib/summary";
import type { AgentId } from "@/lib/types";
import { moodFor } from "@/lib/outfit";
import { WatchList } from "@/components/Watches";

type Folder = "all" | "saved" | AgentId;
/** First in the grid: start a job, or a project to put several jobs in. */
function NewTile({ folder }: { folder: Folder }) {
  const router = useRouter();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function makeProject() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: name.trim() }) });
      const r = (await res.json()) as { url?: string; error?: string };
      if (!r.url) throw new Error(r.error ?? "Couldn't start the project");
      router.push(r.url);
    } catch (e) {
      toast((e as Error).message, "bad");
      setBusy(false);
    }
  }
  return (
    <li className="flex flex-col gap-2 rounded-2xl border-[1.5px] border-dashed border-[#c9c8c2] bg-panel/60 p-2.5">
      <Link href={folder === "all" || folder === "saved" ? "/new" : `/new?agent=${folder}`} className="pressable group flex aspect-[16/9] flex-col items-center justify-center gap-2 rounded-xl bg-agent-soft text-agent-ink hover:bg-agent/15" data-testid="new-job-tile">
        <span className="pix-shadow inline-flex h-11 w-11 items-center justify-center rounded-[10px] border-[1.5px] border-ink bg-agent text-agent-on">
          <Icon name="plus" size={22} stroke={2.4} />
        </span>
        <span className="font-pixel text-[14px]">New job</span>
      </Link>
      {naming ? (
        <form
          className="flex gap-1.5 px-1"
          onSubmit={(e) => {
            e.preventDefault();
            void makeProject();
          }}
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Name it, e.g. Austin trip" aria-label="Project name" className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-panel px-2.5 text-[13px] outline-none focus:border-ink/40" data-testid="new-project-name" />
          <Button type="submit" variant="ghost" className="h-9 px-3 text-[13px]" disabled={busy || !name.trim()}>
            {busy ? <Spinner /> : "Make"}
          </Button>
        </form>
      ) : (
        <button type="button" onClick={() => setNaming(true)} className="pressable mx-1 mb-0.5 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink" data-testid="new-project">
          <Icon name="graph" size={14} /> Or a project for several jobs
        </button>
      )}
    </li>
  );
}

/** The two agents, as doors: what each does and the kinds of jobs behind it. */
function AgentDoors() {
  const DOOR: Record<"inso" | "worko", { line: string; kinds: string[] }> = {
    inso: { line: "Insure what could go wrong, with Gemini's prediction markets.", kinds: ["Weather", "Sports", "Commodities"] },
    worko: { line: "Errands done for you: researched, planned and checked.", kinds: ["Researching", "Planning", "Verifying"] },
  };
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="agent-doors">
      {(["inso", "worko"] as const).map((a, i) => (
        <motion.div key={a} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06, type: "spring", stiffness: 260, damping: 26 }} whileHover={{ y: -3 }}>
          <Link href={`/${a}`} data-agent={a} className="group flex h-full items-center gap-4 rounded-[22px] border-[1.5px] border-ink bg-panel p-4 transition-shadow duration-200 hover:shadow-[6px_6px_0_0_var(--agent)] sm:p-5" data-testid={`door-${a}`}>
            <span className="inline-flex shrink-0 rounded-2xl border-[1.5px] border-ink bg-agent-soft p-1.5 shadow-[2px_2px_0_0_var(--color-ink)] transition-transform duration-200 group-hover:-rotate-3">
              <AgentIcon agent={a} size={56} mood="happy" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-pixel text-[22px] leading-none text-agent-ink">{THEMES[a].name}</span>
              <span className="mt-1.5 block text-[14px] leading-snug text-ink-2">{DOOR[a].line}</span>
              <span className="mt-2.5 flex flex-wrap gap-1.5">
                {DOOR[a].kinds.map((k) => (
                  <span key={k} className="rounded-full border border-agent/30 bg-agent-soft px-2 py-0.5 text-[11.5px] font-semibold text-agent-ink">
                    {k}
                  </span>
                ))}
              </span>
            </span>
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-[1.5px] border-ink transition-colors group-hover:bg-ink group-hover:text-white">
              <Icon name="arrow" size={16} />
            </span>
          </Link>
        </motion.div>
      ))}
    </div>
  );
}

function Dashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const folder = (params.get("folder") as Folder) ?? "all";
  const [q, setQ] = useState(params.get("q") ?? "");
  const { runs, connection } = useRuns();
  const search = useRef<HTMLInputElement>(null);
  const [opened, setOpened] = useState<Record<string, number>>({});
  useAgentTheme(folder === "all" || folder === "saved" ? "inso" : folder);
  useEffect(() => setOpened(openedMap()), [runs]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea")) return;
      if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      }
      if (e.key.toLowerCase() === "n") router.push(folder === "all" || folder === "saved" ? "/new" : `/new?agent=${folder}`);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [router, folder]);

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace(`/home?${p}`, { scroll: false });
  };

  const all = runs ?? [];
  const ids = new Set(all.map((r) => r.id));
  // Jobs inside a project are found in the project, like files in a folder.
  const top = all.filter((r) => !(r.parentId && ids.has(r.parentId)));
  const inFolder = top.filter((r) => folder === "all" || (folder === "saved" ? r.saved : r.agent === folder));
  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = inFolder.filter((r) => !t || [r.task, r.move, r.project?.title].some((x) => x?.toLowerCase().includes(t)));
    // Most recently opened first; never opened ones by when they were made.
    const key = (r: RunSummary) => Math.max(opened[r.id] ?? 0, Date.parse(r.createdAt));
    return [...list].sort((a, b) => key(b) - key(a));
  }, [inFolder, q, opened]);
  const needs = all.filter((r) => r.needsYou > 0).length;
  const count = (f: Folder) => top.filter((r) => f === "all" || (f === "saved" ? r.saved : r.agent === f)).length;
  const folders: { key: Folder; label: string; sub: string }[] = [
    { key: "all", label: "All", sub: "Every agent" },
    ...AGENT_LIST.map((a) => ({ key: a as Folder, label: THEMES[a].name, sub: THEMES[a].domain })),
    { key: "saved", label: "Saved", sub: "Jobs you saved to run again" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Band />
      {folder === "all" && <AgentDoors />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-pixel text-[30px] leading-tight sm:text-[34px]">{folder === "all" ? "Your jobs" : folder === "saved" ? "Saved jobs" : `${THEMES[folder].name} jobs`}</h1>
          <p className="mt-1 text-[14px] text-ink-2" data-testid="jobs-summary">
            {needs > 0 ? (
              <span className="font-medium text-warn-ink">
                {needs} {needs === 1 ? "job needs" : "jobs need"} you.{" "}
              </span>
            ) : null}
            {folder === "all" || folder === "saved" ? "Most recently opened first." : THEMES[folder].tagline}
          </p>
        </div>
        <Link href="/recipes" className="pressable inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-panel px-3.5 text-[13px] font-medium hover:border-ink" data-testid="home-recipes">
          <Icon name="receipt" size={15} /> Recipe book: ideas for everyday problems
        </Link>
        {connection === "reconnecting" && (
          <span className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-warn bg-warn/15 px-3 text-[13px] text-warn-ink" role="status">
            <Spinner /> Reconnecting
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <nav aria-label="Folders" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:pb-0">
          {folders.map((f) => {
            const on = folder === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setParam("folder", f.key === "all" ? null : f.key)}
                aria-current={on ? "page" : undefined}
                data-agent={f.key === "all" || f.key === "saved" ? undefined : f.key}
                title={f.sub}
                className={`pressable tap inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors ${on ? "border-ink bg-ink text-white" : "border-line bg-panel text-ink hover:border-ink"}`}
              >
                <span aria-hidden className={`h-2 w-2 rounded-[2px] ${f.key === "all" || f.key === "saved" ? (on ? "bg-white" : "bg-ink") : "bg-agent"}`} />
                {f.label}
                <span className="num opacity-70">{count(f.key)}</span>
              </button>
            );
          })}
        </nav>
        <div className="ring-agent flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-line bg-panel px-3 sm:max-w-xs">
          <Icon name="search" size={15} className="text-ink-3" />
          <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setParam("q", q || null)} placeholder="Search jobs" aria-label="Search jobs" className="w-full bg-transparent text-sm outline-none" />
          <kbd className="hidden rounded border border-line px-1 text-[10px] text-ink-3 sm:inline">/</kbd>
        </div>
      </div>

      <WatchList />
      {!runs ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="aspect-[16/12] animate-pulse rounded-2xl bg-line/60 motion-reduce:animate-none" />
          ))}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Jobs and projects">
          <NewTile folder={folder} />
          <AnimatePresence initial={false}>
            {visible.map((r) => (
              <Card key={r.id} r={r} opened={opened[r.id]} />
            ))}
          </AnimatePresence>
        </ul>
      )}
      {runs && visible.length === 0 && <p className="text-center text-[14px] text-ink-2">{q ? "No jobs match that search." : "No jobs here yet."}</p>}
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
