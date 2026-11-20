"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { AgentIcon } from "./AgentIcon";
import { Icon } from "./Icon";
import { useTransitionNav } from "./transitions";
import { THEMES } from "@/lib/themes";
import type { RunSummary } from "@/lib/summary";
import { moodFor } from "@/lib/outfit";

export type Badge = "Complete" | "Running" | "In progress" | "Needs you" | "Stopped";

function ago(ms?: number) {
  if (!ms) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}

/** Where a job (or a project) stands, as one of five words. */
export function badgeOf(r: RunSummary): Badge {
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

export function StatusBadge({ b }: { b: Badge }) {
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
export function Preview({ r }: { r: RunSummary }) {
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

export function Card({ r, opened }: { r: RunSummary; opened?: number }) {
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


/** A band of pixel blocks in the agents' colours, across the top of the page. */
export function Band({ single = false }: { /** One agent's colour (from the page's agent theme) instead of all three. */ single?: boolean } = {}) {
  const cols = single ? ["var(--agent)", "var(--agent)"] : ["var(--inso, #6250d6)", "var(--worko, #eb6834)"];
  return (
    <div className="grid h-14 grid-cols-[repeat(24,minmax(0,1fr))] overflow-hidden rounded-2xl border-[1.5px] border-ink sm:h-16" aria-hidden>
      {Array.from({ length: 48 }, (_, i) => {
        const row = Math.floor(i / 24);
        const col = i % 24;
        const on = (col + row) % 2 === 0;
        return <span key={i} style={{ background: on ? cols[Math.floor(col / 12) % 2] : "transparent", opacity: on ? 0.85 - ((col * 7 + row * 3) % 4) * 0.15 : 1 }} />;
      })}
    </div>
  );
}


