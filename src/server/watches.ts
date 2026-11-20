import { randomUUID } from "node:crypto";
import { openDb, type Db } from "./sqlite";
import { answerOf, getPath, parseRef } from "./dataflow";
import type { Proposal, ResearchStep, Run } from "@/lib/types";
import { perCheckUsd, watchStepIds } from "@/lib/watchCost";

/**
 * Watches: a finished job's check, run again on a schedule until a condition is met. You approve
 * once, for a total; each check runs only the steps the condition needs, as its own small job, and
 * the watch stops at its total, its number of checks, its end date, or when the condition is met.
 * Marketplace checks are paid from the app's Gateway balance like any composed job; the caps here
 * are what bound them.
 */
export type Every = "15m" | "1h" | "6h" | "1d";
export const EVERY_MS: Record<Every, number> = { "15m": 15 * 60_000, "1h": 3_600_000, "6h": 6 * 3_600_000, "1d": 86_400_000 };

export interface WatchCondition {
  ref: string;
  op: "<=" | ">=" | "==" | "!=" | "changed";
  value?: string | number;
}

export interface Watch {
  id: string;
  title: string;
  fromRun: string;
  agent: Run["agent"];
  network: "testnet" | "mainnet";
  proposal: Proposal;
  every: Every;
  until: string;
  condition: WatchCondition;
  maxChecks: number;
  perCheckCapUsd: number;
  totalCapUsd: number;
  checks: { at: string; value?: unknown; met: boolean; cost: number; job?: string; failed?: string }[];
  status: "active" | "triggered" | "stopped" | "expired" | "out_of_funds";
  nextAt: string;
  createdAt: string;
}

let db: Db | null | undefined;
const memory = new Map<string, Watch>();
const open = () => (db !== undefined ? db : (db = openDb("watches", "CREATE TABLE IF NOT EXISTS watches (id TEXT PRIMARY KEY, data TEXT NOT NULL, status TEXT NOT NULL, next_at TEXT NOT NULL)")));

export function saveWatch(w: Watch) {
  memory.set(w.id, w);
  const d = open();
  if (!d) return;
  try {
    d.prepare("INSERT INTO watches (id, data, status, next_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, status = excluded.status, next_at = excluded.next_at").run(w.id, JSON.stringify(w), w.status, w.nextAt);
  } catch (e) {
    console.warn("watch not saved:", (e as Error).message);
  }
}

export function allWatches(): Watch[] {
  const d = open();
  if (!d) return [...memory.values()];
  try {
    return (d.prepare("SELECT data FROM watches ORDER BY next_at").all() as { data: string }[]).map((r) => JSON.parse(r.data) as Watch);
  } catch {
    return [...memory.values()];
  }
}
export const watchById = (id: string) => allWatches().find((w) => w.id === id);
export const resetWatches = () => memory.clear();

/** Only the steps a condition needs: the one it reads, and every step that one reads from. */
export function stepsFor(research: ResearchStep[], ref: string): ResearchStep[] {
  const want = new Set(watchStepIds(research, ref));
  return research.filter((s) => want.has(s.id)).map((s) => ({ ...s, when: undefined, verify: undefined, onConflict: undefined }));
}

/** A watch on a finished job: checked, priced and capped before anything runs. */
export function createWatch(run: Run, input: { condition: WatchCondition; every: Every; days: number; title?: string }): Watch | { error: string } {
  if (run.status !== "done" || !run.proposal) return { error: "Only a finished job can be watched" };
  const steps = stepsFor(run.proposal.research, input.condition.ref);
  if (!steps.length) return { error: "That isn't something this job found" };
  const days = Math.min(30, Math.max(1, input.days));
  const until = new Date(Date.now() + days * 86_400_000).toISOString();
  const maxChecks = Math.min(500, Math.ceil((days * 86_400_000) / EVERY_MS[input.every]));
  const perCheckCapUsd = perCheckUsd(run, input.condition.ref);
  const totalCapUsd = Math.round(perCheckCapUsd * maxChecks * 1e6) / 1e6;
  const proposal: Proposal = { ...run.proposal, id: `${run.proposal.id}-watch`, research: steps, gaps: undefined, tier: undefined, compose: run.proposal.compose ? { ...run.proposal.compose, facts: [] } : undefined };
  const now = new Date().toISOString();
  const w: Watch = {
    id: randomUUID().slice(0, 8),
    title: input.title ?? `Watch: ${run.proposal.title}`.slice(0, 80),
    fromRun: run.id,
    agent: run.agent,
    network: run.network === "mainnet" ? "mainnet" : "testnet",
    proposal,
    every: input.every,
    until,
    condition: input.condition,
    maxChecks,
    perCheckCapUsd,
    totalCapUsd,
    checks: [],
    status: "active",
    nextAt: now,
    createdAt: now,
  };
  saveWatch(w);
  return w;
}

const num = (x: unknown) => (typeof x === "number" ? x : Number(String(x).replace(/[$,%\s]/g, "")));
const norm = (x: unknown) => (typeof x === "object" ? JSON.stringify(x) : String(x)).trim().toLowerCase();

/** Whether a check's value meets the condition; "changed" compares with the previous check's value. */
export function conditionMet(c: WatchCondition, value: unknown, previous?: unknown): boolean {
  if (value === undefined || value === null) return false;
  switch (c.op) {
    case "changed":
      return previous !== undefined && norm(previous) !== norm(value);
    case "==":
      return norm(value) === norm(c.value);
    case "!=":
      return norm(value) !== norm(c.value);
    case ">=":
      return Number.isFinite(num(value)) && num(value) >= num(c.value);
    case "<=":
      return Number.isFinite(num(value)) && num(value) <= num(c.value);
  }
}

/** Watches whose next check is due: active, not past their end, not already being checked. */
export function dueWatches(now = Date.now(), busy: Set<string> = new Set()): Watch[] {
  return allWatches().filter((w) => w.status === "active" && Date.parse(w.nextAt) <= now && !busy.has(w.id));
}

/** The watch after one check: its value, whether it met, and what stops it. */
export function afterCheck(w: Watch, check: { value?: unknown; cost: number; job?: string; failed?: string }, now = Date.now()): Watch {
  const previous = [...w.checks].reverse().find((c) => c.value !== undefined && !c.failed)?.value;
  const met = !check.failed && conditionMet(w.condition, check.value, previous);
  const checks = [...w.checks, { at: new Date(now).toISOString(), value: check.value, met, cost: check.cost, job: check.job, failed: check.failed }];
  const spent = checks.reduce((a, c) => a + c.cost, 0);
  const status: Watch["status"] = met ? "triggered" : checks.length >= w.maxChecks || now >= Date.parse(w.until) ? "expired" : spent + w.perCheckCapUsd > w.totalCapUsd + 1e-9 ? "out_of_funds" : "active";
  return { ...w, checks, status, nextAt: new Date(now + EVERY_MS[w.every]).toISOString() };
}

/** Ends a watch that ran past its end date without being checked. */
export function expireOverdue(now = Date.now()) {
  for (const w of allWatches()) if (w.status === "active" && now >= Date.parse(w.until)) saveWatch({ ...w, status: "expired" });
}

/** One check: the watch's steps as a small job, then the value the condition reads. */
export async function runCheck(w: Watch): Promise<Watch> {
  const orch = await import("./orchestrator");
  let job: string | undefined;
  try {
    const created = await orch.createRun({ agent: w.agent, task: w.title, mode: "demo", network: w.network, proposal: { ...w.proposal, id: `${w.proposal.id}-${w.checks.length + 1}` }, plannedBy: orch.WATCH_CHECK }, { quiet: true });
    job = created.id;
    await orch.approve(created.id);
    for (let i = 0; i < 2400; i++) {
      const r = orch.getRun(created.id)!;
      if (r.status === "done" || r.status === "cancelled") break;
      for (const f of r.pendingFailures) orch.resolveFailure(r.id, f.id, f.options.includes("skip") ? "skip" : "cancel");
      for (const q of r.pendingReapprovals) orch.decideReapproval(r.id, q.id, "denied");
      await new Promise((res) => setTimeout(res, 50));
    }
    const r = orch.getRun(created.id)!;
    const cost = r.lines.reduce((a, l) => a + Number(l.actual), 0) / 1e6;
    const ref = parseRef(w.condition.ref);
    const step = ref?.kind === "step" ? r.phases.find((p) => p.id === ref.id) : undefined;
    // A check that didn't deliver isn't a reading: it never counts as met.
    if (!step || step.status !== "done") return afterCheck(w, { cost, job, failed: step?.note ?? "The check didn't deliver" });
    const value = ref?.kind === "step" ? getPath(answerOf(r.results?.[ref.id]), ref.path) : undefined;
    return afterCheck(w, { value, cost, job });
  } catch (e) {
    return afterCheck(w, { cost: 0, job, failed: (e as Error).message.slice(0, 160) });
  }
}

const busy = new Set<string>();
/** The ticker: due watches, at most four at a time, one check per watch at a time. */
export async function tick() {
  expireOverdue();
  const due = dueWatches(Date.now(), busy).slice(0, Math.max(0, 4 - busy.size));
  await Promise.all(
    due.map(async (w) => {
      busy.add(w.id);
      try {
        const next = await runCheck(w);
        const fresh = watchById(w.id);
        // Stopped while it was checking: keep it stopped.
        saveWatch(fresh?.status === "stopped" ? { ...next, status: "stopped" } : next);
      } finally {
        busy.delete(w.id);
      }
    }),
  );
}

export function stopWatch(id: string): Watch | null {
  const w = watchById(id);
  if (!w) return null;
  if (w.status === "active") saveWatch({ ...w, status: "stopped" });
  return watchById(id) ?? null;
}
