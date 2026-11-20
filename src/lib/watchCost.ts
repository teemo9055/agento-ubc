import type { ResearchStep, Run } from "./types";

/**
 * What one check of a watch costs, shared by the "Watch this" form and the server's cap so the two
 * always agree. A check re-runs only the steps the condition needs (the step it reads and the steps
 * that one reads from), each at the price the job approved for it.
 */

const stepOf = (ref: string) => /^\$([A-Za-z][A-Za-z0-9_-]*)(?:\.|$)/.exec(ref)?.[1];

/** The ids of the steps a condition on `ref` needs, in plan order. */
export function watchStepIds(research: ResearchStep[], ref: string): string[] {
  const want = new Set<string>();
  const add = (id: string) => {
    if (want.has(id)) return;
    want.add(id);
    const s = research.find((r) => r.id === id);
    for (const v of Object.values(s?.bind ?? {})) {
      const dep = stepOf(v);
      if (dep) add(dep);
    }
  };
  const first = stepOf(ref);
  if (first) add(first);
  return research.filter((s) => want.has(s.id)).map((s) => s.id);
}

/** USDC one step costs: one call at the approved price; a marketplace step's own price as a fallback. */
function stepUsd(run: Pick<Run, "lines">, step: ResearchStep): number {
  const line = (run.lines ?? []).find((l) => l.phaseId === step.id || l.id === step.id);
  const units = line ? Number(line.calls?.unitPrice ?? line.approved) : Number(step.args.price ?? 0);
  return Number.isFinite(units) ? units / 1e6 : 0;
}

/** The most one check of a watch on `ref` can cost, in USD. */
export function perCheckUsd(run: Pick<Run, "lines" | "proposal">, ref: string): number {
  const research = run.proposal?.research ?? [];
  const usd = watchStepIds(research, ref).reduce((a, id) => a + stepUsd(run, research.find((r) => r.id === id)!), 0);
  return Math.round(usd * 1e6) / 1e6;
}
