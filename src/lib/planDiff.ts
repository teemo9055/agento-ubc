import type { CostLine, Phase } from "./types";

/**
 * What changed between two versions of a plan, by step id: steps added or removed, a price that
 * moved, a seller that changed. Drawn on the graph for a moment after an edit.
 */
export interface PlanDiff {
  added: string[];
  removed: Phase[];
  price: Record<string, { from: string; to: string }>;
  provider: Record<string, { from: string; to: string }>;
}

export function diffPlans(prev: { phases: Phase[]; lines: CostLine[] }, next: { phases: Phase[]; lines: CostLine[] }): PlanDiff {
  const before = new Map(prev.phases.map((p) => [p.id, p]));
  const after = new Map(next.phases.map((p) => [p.id, p]));
  const line = (ls: CostLine[], p?: Phase) => ls.find((l) => l.id === p?.lineId);
  const out: PlanDiff = { added: [], removed: [], price: {}, provider: {} };
  for (const p of next.phases) {
    const was = before.get(p.id);
    if (!was) {
      out.added.push(p.id);
      continue;
    }
    const a = line(prev.lines, was);
    const b = line(next.lines, p);
    if (a && b && a.approved !== b.approved) out.price[p.id] = { from: a.approved, to: b.approved };
    if (a && b && a.payeeName !== b.payeeName) out.provider[p.id] = { from: a.payeeName, to: b.payeeName };
  }
  for (const p of prev.phases) if (!after.has(p.id)) out.removed.push(p);
  return out;
}
