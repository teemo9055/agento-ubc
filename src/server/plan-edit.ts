import type { AgentId, Plan, PlanStep } from "@/lib/types";
import { checkPlanShape, type BuildStep } from "./tools";

/**
 * Changing a plan by hand before it starts: add a step, change what one does, remove one,
 * or rewire what it waits for. Every edit leaves a plan that is still valid, or is refused
 * with the reason. Steps are renumbered in running order after each edit, so "step 3" on
 * screen is always the third thing that can happen.
 */
export const MAX_STEPS = 12;

export type PlanOp =
  | { op: "add"; agent: AgentId; brief: string; after?: string[] }
  | { op: "change"; step: string; brief: string }
  | { op: "remove"; step: string }
  | { op: "wire"; step: string; after: string[]; gate?: "done" | "filled"; useProceeds?: boolean };

/** Orders steps so each comes after everything it waits for, then renumbers them s1…sN. */
export function normalize(steps: PlanStep[]): PlanStep[] | { error: string } {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const done: PlanStep[] = [];
  const placed = new Set<string>();
  // Take the first step, in the order they already have, whose waits are all placed. Steps keep
  // their position unless what they wait for forces them later.
  while (done.length < steps.length) {
    const next = steps.find((s) => !placed.has(s.id) && s.after.every((a) => placed.has(a) || !byId.has(a)));
    if (!next) return { error: "Those steps would wait on each other in a circle" };
    done.push(next);
    placed.add(next.id);
  }
  const rename = new Map(done.map((s, i) => [s.id, `s${i + 1}`]));
  return done.map((s) => ({
    ...s,
    id: rename.get(s.id)!,
    after: [...new Set(s.after.filter((a) => rename.has(a)).map((a) => rename.get(a)!))].sort((x, y) => Number(x.slice(1)) - Number(y.slice(1))),
  }));
}

const placesOrder = (s: PlanStep) => Boolean(s.proposal.action && s.proposal.action.kind !== "itinerary");

/** Wiring that no longer makes sense after an edit is relaxed, not left to fail later. */
function settle(steps: PlanStep[]): PlanStep[] {
  return steps.map((s) => {
    const deps = s.after.map((id) => steps.find((x) => x.id === id)!).filter(Boolean);
    const canFill = deps.some(placesOrder);
    const gate = s.gate === "filled" && !canFill ? "done" : s.gate;
    const sells = deps.filter((d) => (d.proposal.action?.kind === "prediction_order" && d.proposal.action.trade === "sell") || (d.proposal.action?.kind === "spot_order" && d.proposal.action.side === "sell"));
    return { ...s, gate, useProceeds: s.useProceeds && gate === "filled" && sells.length === 1 ? true : undefined };
  });
}

export async function editPlan(plan: Plan, op: PlanOp, build: BuildStep): Promise<{ plan: Plan } | { error: string }> {
  let steps = plan.steps.map((s) => ({ ...s, after: [...(s.after ?? [])] }));
  const find = (id: string) => steps.find((s) => s.id === id);
  const stamp = Math.random().toString(36).slice(2, 7);

  if (op.op === "add") {
    if (steps.length >= MAX_STEPS) return { error: `A plan can have up to ${MAX_STEPS} steps` };
    const built = await build(op.agent, op.brief, `${plan.id}-n${stamp}`);
    if ("error" in built) return built;
    steps.push({ id: `new-${stamp}`, agent: op.agent, proposal: built.proposal, after: (op.after ?? []).filter((a) => find(a)), gate: "done", brief: op.brief, status: "waiting" });
  } else if (op.op === "change") {
    const s = find(op.step);
    if (!s) return { error: "That step isn't in the plan" };
    // The agent hears what the step was and what should change, and builds it again with its own tools.
    const built = await build(s.agent, `${s.brief ?? s.proposal.title}. Change: ${op.brief}`, `${plan.id}-c${stamp}`);
    if ("error" in built) return built;
    Object.assign(s, { proposal: built.proposal, brief: `${s.brief ?? s.proposal.title}. Change: ${op.brief}`.slice(0, 400) });
  } else if (op.op === "remove") {
    if (!find(op.step)) return { error: "That step isn't in the plan" };
    if (steps.length <= 1) return { error: "A plan needs at least one step. Ask for something else in the chat instead." };
    steps = steps.filter((s) => s.id !== op.step).map((s) => ({ ...s, after: s.after.filter((a) => a !== op.step) }));
  } else {
    const s = find(op.step);
    if (!s) return { error: "That step isn't in the plan" };
    if (op.after.includes(s.id)) return { error: "A step can't wait for itself" };
    s.after = op.after.filter((a) => find(a));
    if (op.gate) s.gate = op.gate;
    if (op.useProceeds !== undefined) s.useProceeds = op.useProceeds || undefined;
  }

  const ordered = normalize(steps);
  if ("error" in ordered) return ordered;
  // An explicit request for a fill gate or proceeds that can't work is refused; leftovers from other edits are relaxed.
  if (op.op === "wire") {
    const wrong = checkPlanShape(ordered);
    if (wrong) return { error: wrong };
  }
  const settled = settle(ordered);
  const wrong = checkPlanShape(settled);
  if (wrong) return { error: wrong };
  return { plan: { ...plan, steps: settled.map((s) => ({ ...s, status: "waiting", runId: undefined, note: undefined })), status: "proposed" } };
}
