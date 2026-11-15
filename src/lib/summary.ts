import { sum } from "./money";
import { paidInUsdc, type AgentId, type Run, type RunStatus } from "./types";
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
  planning: boolean;
  thinking: boolean;
  /** Latest chat line, for jobs still exploring. */
  lastMessage?: string;
  move?: string;
  /** The move's exchange order, for lists: open, filled, cancelled… */
  order?: { status: string; filled?: number; quantity?: number; venue: string };
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
    approved: sum(r.lines.filter((l) => paidInUsdc(l.rail)).map((l) => l.approved)).toString(),
    spent: sum(r.lines.map((l) => l.actual)).toString(),
    refunded: r.refunded,
    needsYou: r.pendingReapprovals.length + r.pendingFailures.length,
    stepsDone: r.phases.filter((p) => p.status === "done" || p.status === "skipped").length,
    stepsTotal: r.phases.length,
    activeStep: r.phases.find((p) => p.status === "active" || p.status === "awaiting_reapproval" || p.status === "failed_waiting")?.label,
    headline: r.deliverable?.summary,
    faults: r.faults.length,
    outfit: runOutfit(r),
    planning: Boolean(r.planning),
    thinking: Boolean(r.thinking),
    lastMessage: r.chat?.[r.chat.length - 1]?.text.slice(0, 140),
    move: r.proposal?.title,
    order: r.order && { status: r.order.status, filled: r.order.filledQuantity, quantity: r.order.quantity, venue: r.order.venue },
  };
}

export const runOutfit = (r: Run): Outfit => outfitFor(r.agent, [r.task, ...r.phases.map((p) => p.sub), r.deliverable?.summary ?? ""].join(" "));
