import { sum } from "./money";
import type { AgentId, Run, RunStatus } from "./types";
import { outfitFor, type Outfit } from "./outfit";

/** Light view of a run for lists; no data feeds or event payloads. */
export interface RunSummary {
  id: string;
  agent: AgentId;
  task: string;
  status: RunStatus;
  mode: "demo" | "live";
  planner: "ai" | "rules";
  createdAt: string;
  finishedAt?: string;
  approved: string;
  spent: string;
  refunded?: string;
  needsYou: number;
  stepsDone: number;
  stepsTotal: number;
  activeStep?: string;
  headline?: string;
  faults: number;
  outfit: Outfit;
}

export function summarize(r: Run): RunSummary {
  return {
    id: r.id,
    agent: r.agent,
    task: r.task,
    status: r.status,
    mode: r.mode,
    planner: r.planner ?? "rules",
    createdAt: r.createdAt,
    finishedAt: r.finishedAt,
    approved: sum(r.lines.map((l) => l.approved)).toString(),
    spent: sum(r.lines.map((l) => l.actual)).toString(),
    refunded: r.refunded,
    needsYou: r.pendingReapprovals.length + r.pendingFailures.length,
    stepsDone: r.phases.filter((p) => p.status === "done" || p.status === "skipped").length,
    stepsTotal: r.phases.length,
    activeStep: r.phases.find((p) => p.status === "active" || p.status === "awaiting_reapproval" || p.status === "failed_waiting")?.label,
    headline: r.deliverable?.summary,
    faults: r.faults.length,
    outfit: runOutfit(r),
  };
}

export const runOutfit = (r: Run): Outfit => outfitFor(r.agent, [r.task, ...r.phases.map((p) => p.sub), r.deliverable?.summary ?? ""].join(" "));
