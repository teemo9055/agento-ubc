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
import { THEMES } from "@/lib/themes";
import { openedMap } from "@/lib/opened";
import type { RunSummary } from "@/lib/summary";
import type { AgentId } from "@/lib/types";
import { moodFor } from "@/lib/outfit";

type Folder = "all" | "saved" | AgentId;
type Badge = "Complete" | "Running" | "In progress" | "Needs you" | "Stopped";

function ago(ms?: number) {
  if (!ms) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

/** Where a job (or a project) stands, as one of five words. */
function badgeOf(r: RunSummary): Badge {
  if (r.needsYou > 0) return "Needs you";
  if (r.project && r.status === "exploring") return r.project.status === "running" ? "Running" : r.project.status === "done" ? "Complete" : r.project.status === "stopped" ? "Stopped" : "In progress";
  if (r.status === "done") return "Complete";
  if (r.status === "cancelled") return "Stopped";
  if (r.status === "running" || r.status === "funding") return "Running";
  return "In progress";
}

const BADGE: Record<Badge, string> = {
  Complete: "bg-good text-white",
  Running: "bg-agent text-agent-on",
  "In progress": "bg-panel text-ink border border-line",
  "Needs you": "bg-warn text-ink border-[1.5px] border-ink",
  Stopped: "bg-[#e9e8e3] text-ink-2",
};

function StatusBadge({ b }: { b: Badge }) {
  return (
    <span className={`inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11.5px] font-semibold shadow-[0_1px_0_rgb(11_11_11/0.08)] ${BADGE[b]}`} data-testid="card-status">
      {b === "Running" && <span className="mascot-spark h-1.5 w-1.5 bg-current" aria-hidden />}
      {b === "Complete" && <Icon name="check" size={11} stroke={3} />}
      {b === "Needs you" && <span className="font-pixel text-[11px]">!</span>}
      {b}
    </span>
  );
}

/**
 * A small live picture of the job: its steps as a row of blocks (done, running, waiting) drawn on
 * a blocky pattern in the agent's colour. A project shows its jobs the same way.
 */
function Preview({ r }: { r: RunSummary }) {
  const total = r.project ? r.project.total : r.stepsTotal;
  const done = r.project ? r.project.done : r.stepsDone;
  const running = r.project ? r.project.status === "running" : r.status === "running" || r.status === "funding";
  const n = Math.min(total, 6);
  return (
    <div className="preview-blocks relative flex aspect-[16/9] items-center justify-center overflow-hidden rounded-xl border border-ink/10" aria-hidden>
      {n > 0 ? (
        <div className="flex items-center">
          {Array.from({ length: n }, (_, i) => {
            const state = i < done ? "done" : i === done && running ? "run" : "wait";
            return (
              <div key={i} className="flex items-center">
                {i > 0 && <span className={`h-[2px] w-4 sm:w-5 ${i <= done ? "bg-ink" : "border-t-2 border-dashed border-ink/30"}`} />}
                <span
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-[6px] border-[1.5px] ${
                    state === "done" ? "border-ink bg-ink text-white" : state === "run" ? "border-ink bg-agent shadow-[2px_2px_0_0_var(--color-ink)]" : "border-dashed border-ink/40 bg-panel/80"
                  }`}
                >
                  {state === "done" && <Icon name="check" size={13} stroke={3} />}
                  {state === "run" && <span className="mascot-spark h-1.5 w-1.5 bg-white" />}
                </span>
              </div>
            );
          })}
          {total > n && <span className="num ml-2 text-[12px] font-semibold text-ink-2">+{total - n}</span>}
        </div>
      ) : (
        <div className="max-w-[80%] rounded-lg border border-ink/15 bg-panel/90 px-3 py-2 text-[12px] leading-snug text-ink-2 shadow-sm">
          <span className="line-clamp-2">{r.lastMessage ?? "Talking it through"}</span>
        </div>
      )}
    </div>
  );
}

function Card({ r, opened }: { r: RunSummary; opened?: number }) {
  const nav = useTransitionNav();
  const href = r.project ? `/projects/${r.id}` : `/runs/${r.id}`;
  const b = badgeOf(r);
  const title = r.project?.title ?? r.move ?? r.task;
  const line =
    b === "Needs you"
      ? "Waiting for your decision"
      : b === "Running"
        ? (r.project ? `${r.project.done} of ${r.project.total} jobs done` : r.activeStep) ?? "Running"
        : b === "Complete" || b === "Stopped"
          ? r.outcome.headline
          : opened
            ? `Opened ${ago(opened)}`
            : `Started ${ago(Date.parse(r.createdAt))}`;
  return (
    <motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} data-agent={r.agent} className={r.project ? "relative pt-2" : ""}>
      {/* A project is a folder: two sheets behind the card. */}
      {r.project && (
        <>
          <span className="absolute inset-x-4 top-0 h-6 rounded-t-xl border border-b-0 border-line bg-agent-soft" aria-hidden />
          <span className="absolute inset-x-2 top-1 h-6 rounded-t-xl border border-b-0 border-line bg-panel" aria-hidden />
        </>
      )}
      <Link
        href={href}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          nav(href, { waitForPage: true });
        }}
        className={`pix-lift pressable group relative block rounded-2xl border bg-panel p-2.5 ${b === "Needs you" ? "border-ink shadow-[3px_3px_0_0_var(--color-warn)]" : "border-line"}`}
        data-testid={`job-${r.id}`}
        data-kind={r.project ? "project" : "job"}
      >
        <div className="relative">
          <Preview r={r} />
          <div className="absolute right-2 top-2">
            <StatusBadge b={b} />
          </div>
          <div className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-md border border-ink/10 bg-panel/95 py-0.5 pl-0.5 pr-2 shadow-sm">
            <span style={{ viewTransitionName: `mascot-${r.id}` }}>
              <AgentIcon agent={r.agent} size={22} outfit={r.outfit} mood={moodFor(r.status, r.needsYou)} />
            </span>
            <span className="font-pixel text-[11px] text-agent-ink">{r.project ? "Project" : THEMES[r.agent].name}</span>
          </div>
        </div>
        <div className="flex items-end justify-between gap-3 px-1.5 pb-1 pt-2.5">
          <div className="min-w-0">
            <div className="line-clamp-2 text-[14.5px] font-semibold leading-snug" style={{ viewTransitionName: `task-${r.id}` }}>
              {title}
            </div>
            <div className={`mt-0.5 truncate text-[12.5px] ${b === "Needs you" ? "font-medium text-warn-ink" : "text-ink-3"}`}>
              {line}
              {r.mode !== "live" && b !== "In progress" ? " · practice" : ""}
            </div>
          </div>
          <span className="inline-flex h-7 shrink-0 items-center rounded-full border border-line px-3 text-[12px] font-semibold text-ink-2 transition-colors group-hover:border-ink group-hover:text-ink">Open</span>
        </div>
      </Link>
    </motion.li>
  );
}

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

/** A band of pixel blocks in the agents' colours, across the top of the page. */
function Band() {
  const cols = ["var(--inso, #6250d6)", "var(--trado, #2368c4)", "var(--travo, #eb6834)"];
  return (
    <div className="grid h-14 grid-cols-[repeat(24,minmax(0,1fr))] overflow-hidden rounded-2xl border-[1.5px] border-ink sm:h-16" aria-hidden>
      {Array.from({ length: 48 }, (_, i) => {
        const row = Math.floor(i / 24);
        const col = i % 24;
        const on = (col + row) % 2 === 0;
        return <span key={i} style={{ background: on ? cols[Math.floor(col / 8) % 3] : "transparent", opacity: on ? 0.85 - ((col * 7 + row * 3) % 4) * 0.15 : 1 }} />;
      })}
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
    ...(Object.keys(THEMES) as AgentId[]).map((a) => ({ key: a as Folder, label: THEMES[a].name, sub: THEMES[a].domain })),
    { key: "saved", label: "Saved", sub: "Jobs you saved to run again" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Band />
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
      {runs && visible.length === 0 && <p className="text-center text-[14px] text-ink-2">{q ? "No jobs match that search." : "No jobs here yet. Start one: the agent prices it before it spends anything."}</p>}
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
