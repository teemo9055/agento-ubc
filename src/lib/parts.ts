import type { PhaseStatus, PlanStep, Proposal, Run } from "./types";
import { stepName } from "./plain";
import { templateOf, watchesOrder } from "./templates";
import { actionText, conditionLabel, lookupCost } from "./move";

/**
 * The sub-tasks inside one step of a plan: the same pieces its job will run (each paid lookup,
 * the check, the order or the route, watching it fill), so the board can show them before the
 * step starts and tick them off while it runs. Ids match the job's phases.
 */
export interface Part {
  id: string;
  label: string;
  sub?: string;
  cost?: number;
}

export type PartState = "planned" | "active" | "done" | "failed" | "skipped";

export function partsOf(p: Proposal): Part[] {
  const out: Part[] = p.research.map((r) => ({ id: r.id, label: stepName(r), sub: r.why, cost: lookupCost(r) }));
  const t = templateOf(p);
  const checks = p.condition ? [p.condition, ...(p.also ?? [])] : [];
  if (t === "answer") out.push({ id: "check", label: "Write it up", sub: "what the data says" });
  if (t === "check_trade") out.push({ id: "check", label: checks.length > 1 ? "Check the conditions" : "Check the condition", sub: checks.map(conditionLabel).join(" and ") });
  const a = p.action;
  if (a && a.kind !== "itinerary") {
    out.push({ id: "act", label: a.kind === "prediction_order" ? (a.trade === "sell" ? "Place the sell" : "Place the order") : "Place the trade", sub: actionText(a) });
    if (watchesOrder(p)) out.push({ id: "watch", label: "Watch until filled" });
  } else if (a?.kind === "itinerary") out.push({ id: "act", label: "Plan the days", sub: `${a.stops.length} stops · ≤ ${a.hoursPerDay} h a day` });
  return out;
}

const STATE: Record<PhaseStatus, PartState> = {
  planned: "planned",
  active: "active",
  awaiting_reapproval: "active",
  failed_waiting: "failed",
  done: "done",
  failed: "failed",
  skipped: "skipped",
};

/** Where each sub-task of a running or finished step stands, read from its job. */
export function partsProgress(child: Pick<Run, "phases">): NonNullable<PlanStep["parts"]> {
  return Object.fromEntries(child.phases.map((ph) => [ph.id, { state: STATE[ph.status], note: ph.note && ph.note !== ph.label ? ph.note.slice(0, 140) : undefined }]));
}
