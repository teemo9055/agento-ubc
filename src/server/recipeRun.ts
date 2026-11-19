import { coerce } from "./dataflow";
import { validateProposal } from "./tools";
import { BadInput } from "./x402";
import { withNet } from "./netContext";
import { liveReady } from "./chain";
import type { IoType } from "./catalog/types";
import type { LearnedRecipe } from "./learn";
import type { Proposal, Report } from "@/lib/types";

/**
 * Running a learned recipe for someone else (an outside agent that paid for it): its steps with
 * the buyer's values filled in, checked and priced like any move, run as an internal job whose
 * marketplace lookups are paid from the app's own Gateway balance. No user vault is involved.
 */

/** The buyer's values, checked against what each placeholder stands for. */
export function recipeInputs(r: LearnedRecipe, get: (name: string) => string | null): Record<string, { type: string; value: string }> {
  const out: Record<string, { type: string; value: string }> = {};
  for (const n of r.needs) {
    const raw = get(n.name);
    if (!raw) throw new BadInput(`Give ${n.name} (${n.type.replace(/_/g, " ")})`);
    const v = coerce(n.type as IoType, raw);
    if (v == null) throw new BadInput(`${n.name} isn't a valid ${n.type.replace(/_/g, " ")}`);
    out[n.name] = { type: n.type, value: String(v) };
  }
  return out;
}

const fill = (s: string, givens: Record<string, { value: string }>) => s.replace(/\{\{given\.([a-z0-9_]+)\}\}/gi, (_, name: string) => givens[name]?.value ?? "");

export async function recipeProposal(r: LearnedRecipe, givens: Record<string, { type: string; value: string }>, id: string): Promise<Proposal> {
  const input = {
    title: r.title.slice(0, 60),
    why: r.gets.slice(0, 240),
    ask: `${r.title} in ${r.steps.length} steps?`.slice(0, 160),
    research: r.steps.map((s) => ({
      id: s.id,
      tool: s.tool,
      args: Object.fromEntries(Object.entries(s.args).map(([k, v]) => [k, k === "input" ? JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(v || "{}") as Record<string, unknown>).map(([f, x]) => [f, typeof x === "string" ? fill(x, givens) : x]))) : fill(v, givens)])),
      label: fill(s.label, givens).slice(0, 60),
      why: fill(s.why, givens).slice(0, 140),
      ...(s.bind ? { bind: s.bind } : {}),
      ...(s.when ? { when: s.when } : {}),
      ...(s.verify ? { verify: s.verify } : {}),
      ...(s.onConflict ? { onConflict: s.onConflict } : {}),
      ...(s.lane ? { lane: s.lane } : {}),
    })),
    action: null,
    condition: null,
    budgetUsd: null,
    givens,
    compose: { searched: 0, relevant: 0, considered: 0, facts: r.facts, ms: 0 },
  };
  const v = await withNet(r.network, () => validateProposal("worko", input, id, { composed: true }));
  if ("error" in v) throw new Error(`This recipe can't run right now: ${v.error}`);
  return v.proposal;
}

export interface RecipeResult {
  report: Report | null;
  receipt: { job: string; spentUsd: number; steps: { step: string; seller: string; paidUsd: number; delivered: boolean; tx?: string }[] };
  /** Every must-know step delivered. */
  ok: boolean;
}

/** Runs it to the end (at most two minutes), skipping optional steps that fail. */
export async function runRecipe(r: LearnedRecipe, givens: Record<string, { type: string; value: string }>, opts: { timeoutMs?: number } = {}): Promise<RecipeResult> {
  const orch = await import("./orchestrator");
  const proposal = await recipeProposal(r, givens, `recipe-${Date.now().toString(36)}`);
  const mode = liveReady(r.network) ? "live" : "demo";
  const created = await orch.createRun({ agent: "worko", task: r.title, mode, network: r.network, proposal, plannedBy: orch.RECIPE_BUYER }, { quiet: true });
  await orch.approve(created.id);
  const until = Date.now() + (opts.timeoutMs ?? 120_000);
  for (;;) {
    const run = orch.getRun(created.id)!;
    if (run.status === "done" || run.status === "cancelled") break;
    for (const f of run.pendingFailures) orch.resolveFailure(run.id, f.id, f.options.includes("skip") ? "skip" : "cancel");
    for (const q of run.pendingReapprovals) orch.decideReapproval(run.id, q.id, "denied");
    if (Date.now() > until) {
      await orch.cancel(run.id);
      break;
    }
    await new Promise((res) => setTimeout(res, 50));
  }
  const run = orch.getRun(created.id)!;
  const must = new Set((run.lanes ?? []).filter((l) => l.importance === "must").map((l) => l.id));
  const mustSteps = run.phases.filter((p) => p.lineId && p.lane && must.has(p.lane) && !p.tieBreaker);
  return {
    report: run.report ?? null,
    receipt: {
      job: run.id,
      spentUsd: run.lines.reduce((a, l) => a + Number(l.actual), 0) / 1e6,
      steps: run.phases
        .filter((p) => p.lineId)
        .map((p) => {
          const line = run.lines.find((l) => l.id === p.lineId)!;
          const pay = p.payments.find((x) => x.txState === "settled");
          return { step: p.label, seller: line.payeeName, paidUsd: Number(line.actual) / 1e6, delivered: p.status === "done", ...(pay?.txHash ? { tx: pay.txHash } : {}) };
        }),
    },
    ok: run.status === "done" && mustSteps.every((p) => p.status === "done"),
  };
}
