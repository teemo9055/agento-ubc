"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { AgentId, Plan, PlanStep, Run } from "@/lib/types";
import { THEMES } from "@/lib/themes";
import { AgentIcon } from "./AgentIcon";
import { Assemble } from "./Assemble";
import { actionText, stepCost, usdc } from "./Chat";
import { Button, Spinner } from "./ui";
import { Icon } from "./Icon";
import { post } from "./useRun";
import { toast } from "./Toaster";

/** The plan the user is looking at: as edited on the board, or the latest one proposed in chat. */
export function planOf(run: Run): Plan | undefined {
  const latest = [...(run.chat ?? [])].reverse().find((m) => m.plan)?.plan;
  return run.plan && (!latest || run.plan.id === latest.id) ? run.plan : latest;
}

const STATUS: Record<PlanStep["status"], { text: string; cls: string; ring: string }> = {
  waiting: { text: "Waiting", cls: "text-ink-3", ring: "border-line" },
  running: { text: "Running", cls: "text-agent-ink", ring: "border-agent glow" },
  blocked: { text: "Waiting for a fill", cls: "text-warn-ink", ring: "border-warn" },
  done: { text: "Done", cls: "text-good", ring: "border-good/60" },
  failed: { text: "Didn't go through", cls: "text-bad", ring: "border-bad/60" },
  skipped: { text: "Skipped", cls: "text-ink-3", ring: "border-line opacity-60" },
};

const money = (x: number) => (x <= 0 ? "free" : `≤ $${x < 0.01 ? usdc(x) : x.toFixed(2)}`);
const n = (id: string) => id.replace(/^s/, "");
const placesOrder = (s: PlanStep) => Boolean(s.proposal.action && s.proposal.action.kind !== "itinerary");
const sells = (s: PlanStep) => (s.proposal.action?.kind === "prediction_order" && s.proposal.action.trade === "sell") || (s.proposal.action?.kind === "spot_order" && s.proposal.action.side === "sell");

interface Edge {
  id: string;
  d: string;
  live: boolean;
  done: boolean;
  fill: boolean;
}

/**
 * A plan as a map of the work: stages left to right, a line from each step to what it waits for.
 * Before it starts every part can be changed by hand; while it runs it shows where things stand.
 */
/** The step whose sale pays for this one: the one it waits for that sells something. */
function sellerOf(s: PlanStep, steps: PlanStep[]) {
  return (s.after ?? []).find((a) => {
    const d = steps.find((x) => x.id === a)?.proposal.action;
    return Boolean(d && ((d.kind === "prediction_order" && d.trade === "sell") || (d.kind === "spot_order" && d.side === "sell")));
  });
}

export function PlanBoard({ plan, run }: { plan: Plan; run: Run }) {
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [addText, setAddText] = useState("");
  const [addAgent, setAddAgent] = useState<"auto" | AgentId>("auto");
  const [change, setChange] = useState("");
  const [edges, setEdges] = useState<Edge[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const stage = useRef<HTMLDivElement>(null);

  const editable = plan.status === "proposed" && run.status === "exploring";
  const steps = plan.steps;
  const byId = useMemo(() => new Map(steps.map((s) => [s.id, s])), [steps]);
  const picked = sel ? byId.get(sel) : undefined;

  // How far along each step is: 0 for steps that wait for nothing, then one more than the furthest thing they wait for.
  const depth = useMemo(() => {
    const d = new Map<string, number>();
    for (const s of steps) d.set(s.id, s.after?.length ? Math.max(...s.after.map((a) => (d.get(a) ?? 0) + 1)) : 0);
    return d;
  }, [steps]);
  const stages = useMemo(() => {
    const cols: PlanStep[][] = [];
    for (const s of steps) (cols[depth.get(s.id) ?? 0] ??= []).push(s);
    return cols.filter(Boolean);
  }, [steps, depth]);
  const total = steps.reduce((a, s) => a + stepCost(s.proposal), 0);
  const doneCount = steps.filter((s) => s.status === "done").length;

  // Lines are measured from where the cards actually are, and re-measured when anything moves.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      const at = (id: string) => el.querySelector<HTMLElement>(`[data-step="${id}"]`)?.getBoundingClientRect();
      const out: Edge[] = [];
      for (const s of steps)
        for (const a of s.after ?? []) {
          const from = at(a);
          const to = at(s.id);
          if (!from || !to) continue;
          const x1 = from.right - box.left;
          const y1 = from.top + from.height / 2 - box.top;
          const x2 = to.left - box.left;
          const y2 = to.top + to.height / 2 - box.top;
          const bend = Math.max(24, (x2 - x1) / 2);
          const dep = byId.get(a);
          out.push({ id: `${a}-${s.id}`, d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`, live: dep?.status === "done" && s.status === "running", done: dep?.status === "done" && s.status === "done", fill: s.gate === "filled" });
        }
      setEdges(out);
      setSize({ w: el.scrollWidth, h: el.scrollHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [steps, byId]);

  useEffect(() => {
    if (sel && !byId.has(sel)) setSel(null);
    setChange("");
  }, [sel, byId]);

  async function act(key: string, path: string, body: unknown, ok?: string) {
    setBusy(key);
    try {
      await post(`/api/runs/${run.id}/${path}`, body);
      if (ok) toast(ok, "good");
      return true;
    } catch (e) {
      toast((e as Error).message, "bad");
      return false;
    } finally {
      setBusy("");
    }
  }
  const wire = (s: PlanStep, patch: Partial<Pick<PlanStep, "after" | "gate" | "useProceeds">>) => act("wire", "plan-edit", { op: "wire", step: s.id, after: patch.after ?? s.after ?? [], gate: patch.gate ?? s.gate, useProceeds: patch.useProceeds ?? Boolean(s.useProceeds) });

  const deps = picked ? (picked.after ?? []).map((a) => byId.get(a)!).filter(Boolean) : [];
  const canFill = deps.some(placesOrder);
  const canSpend = canFill && deps.filter(sells).length === 1 && picked?.proposal.action?.kind !== "itinerary";

  return (
    <section className="rounded-2xl border border-line bg-panel" aria-label="Plan" data-testid="plan-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#f1f0ec] px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <div className="font-pixel text-[12px] text-agent-ink">The plan</div>
          <h2 className="mt-0.5 text-[18px] font-semibold leading-snug">{plan.title}</h2>
          <p className="mt-0.5 text-[13.5px] text-ink-2">{plan.why}</p>
        </div>
        <span className={`shrink-0 text-[12.5px] font-semibold ${plan.status === "done" ? "text-good" : plan.status === "running" ? "text-agent-ink" : "text-ink-3"}`} data-testid="plan-status">
          {plan.status === "proposed" ? `${steps.length} steps · ${stages.length} ${stages.length === 1 ? "stage" : "stages"}` : plan.status === "running" ? `Running · ${doneCount} of ${steps.length} done` : plan.status === "done" ? "Finished" : "Stopped"}
        </span>
      </div>

      <Assemble play={plan.id} className="overflow-x-auto">
        <div ref={stage} className="relative flex min-w-full flex-col gap-4 p-4 sm:w-max sm:flex-row sm:gap-12 sm:p-5">
          <svg className="pointer-events-none absolute left-0 top-0 hidden sm:block" width={size.w} height={size.h} aria-hidden>
            <defs>
              <marker id="plan-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M 0 0.5 L 7.5 4 L 0 7.5 z" fill="context-stroke" />
              </marker>
            </defs>
            {edges.map((e) => (
              <path key={e.id} d={e.d} fill="none" markerEnd="url(#plan-arrow)" className={e.live ? "plan-edge-live" : e.fill ? "plan-edge" : "plan-edge-solid"} stroke={e.done || e.live ? "var(--agent)" : "#a9a79e"} strokeWidth={e.live ? 2.25 : 1.75} />
            ))}
          </svg>
          {stages.map((col, ci) => (
            <div key={ci} className="relative flex flex-col gap-3 sm:w-[236px]">
              <div className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">{stages.length > 1 ? (ci === 0 ? "Starts right away" : `Stage ${ci + 1}`) : "Steps"}</div>
              {col.map((s) => {
                const st = STATUS[s.status];
                const cost = stepCost(s.proposal);
                const on = sel === s.id;
                return (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={on}
                    data-step={s.id}
                    data-block
                    data-agent={s.agent}
                    data-testid="plan-step"
                    onClick={() => setSel(on ? null : s.id)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSel(on ? null : s.id))}
                    className={`pressable cursor-pointer rounded-xl border-[1.5px] bg-panel p-3 text-left text-[13px] outline-none transition-shadow focus-visible:shadow-[0_0_0_2px_var(--agent)] ${on ? "border-ink shadow-[3px_3px_0_0_var(--agent)]" : plan.status === "proposed" ? "border-line hover:border-ink/40" : st.ring}`}
                  >
                    <div className="flex items-start gap-2">
                      <AgentIcon agent={s.agent} size={26} mood={s.status === "running" ? "working" : s.status === "failed" ? "sad" : "happy"} />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold leading-snug">
                          {n(s.id)}. {s.proposal.title}
                        </div>
                        <div className="num mt-0.5 text-[12px] text-ink-3">
                          {THEMES[s.agent].name} · {money(cost)}
                          {s.proposal.research.length ? ` · ${s.proposal.research.length} paid lookup${s.proposal.research.length > 1 ? "s" : ""}` : ""}
                        </div>
                      </div>
                    </div>
                    {(s.after ?? []).length > 0 && (
                      <div className="mt-1.5 text-[12px] text-ink-3 sm:hidden">
                        After step {(s.after ?? []).map(n).join(" and ")}
                      </div>
                    )}
                    {(s.gate === "filled" || s.useProceeds) && plan.status === "proposed" && (
                      <div className="mt-1.5 text-[12px] text-ink-2">{s.useProceeds ? `Spends what step ${n(sellerOf(s, steps) ?? s.after[0])} brings in` : "Starts once the order before it fills"}</div>
                    )}
                    {plan.status !== "proposed" && (
                      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-2 text-[12px]">
                        <span className={`font-semibold ${st.cls}`} data-testid="plan-step-status">
                          {st.text}
                        </span>
                        {s.runId && (
                          <Link href={`/runs/${s.runId}`} onClick={(e) => e.stopPropagation()} className="text-ink-2 underline decoration-line underline-offset-2" data-testid="plan-step-link">
                            Open
                          </Link>
                        )}
                        {s.note && s.note !== st.text && <span className="w-full text-ink-2">{s.note}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </Assemble>

      {picked && (
        <div className="border-t border-[#f1f0ec] bg-surface/60 px-4 py-3.5 sm:px-5" data-testid="plan-inspector" data-agent={picked.agent}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[14px] font-semibold">
                Step {n(picked.id)}: {picked.proposal.title}
              </div>
              <p className="mt-0.5 text-[13px] text-ink-2">{picked.proposal.ask}</p>
              <p className="num mt-1 text-[12.5px] text-ink-3">
                {THEMES[picked.agent].name} · {money(stepCost(picked.proposal))}
                {picked.proposal.action ? ` · ${actionText(picked.proposal.action)}` : ""}
                {picked.proposal.research.length ? ` · buys: ${picked.proposal.research.map((r) => r.label).join(", ")}` : ""}
              </p>
            </div>
            <button type="button" onClick={() => setSel(null)} aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 hover:bg-ink/5 hover:text-ink">
              <Icon name="x" size={14} stroke={2} />
            </button>
          </div>

          {editable && (
            <div className="mt-3 space-y-3 text-[13px]">
              {steps.length > 1 && (
                <div>
                  <div className="mb-1 text-[12px] font-semibold text-ink-2">Waits for</div>
                  <div className="flex flex-wrap gap-1.5" data-testid="plan-waits">
                    {steps
                      .filter((x) => x.id !== picked.id)
                      .map((x) => {
                        const on = (picked.after ?? []).includes(x.id);
                        return (
                          <button
                            key={x.id}
                            type="button"
                            aria-pressed={on}
                            disabled={Boolean(busy)}
                            onClick={() => wire(picked, { after: on ? (picked.after ?? []).filter((a) => a !== x.id) : [...(picked.after ?? []), x.id] })}
                            className={`pressable max-w-[220px] truncate rounded-lg border px-2.5 py-1 text-[12.5px] ${on ? "border-ink bg-ink text-white" : "border-line bg-panel text-ink-2 hover:border-ink/40"}`}
                          >
                            {n(x.id)}. {x.proposal.title}
                          </button>
                        );
                      })}
                  </div>
                  <p className="mt-1 text-[12px] text-ink-3">{(picked.after ?? []).length ? "It starts when these are done." : "Nothing: it starts right away, alongside the others."}</p>
                </div>
              )}
              {canFill && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--agent)]" checked={picked.gate === "filled"} disabled={Boolean(busy)} onChange={(e) => wire(picked, { gate: e.target.checked ? "filled" : "done", useProceeds: e.target.checked ? Boolean(picked.useProceeds) : false })} />
                    Only once the order before it has filled
                  </label>
                  {canSpend && (
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input type="checkbox" className="h-4 w-4 accent-[var(--agent)]" checked={Boolean(picked.useProceeds)} disabled={Boolean(busy)} onChange={(e) => wire(picked, { gate: "filled", useProceeds: e.target.checked })} />
                      Spend what that sale brings in
                    </label>
                  )}
                </div>
              )}
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (change.trim().length < 2) return;
                  if (await act("change", "plan-edit", { op: "change", step: picked.id, brief: change.trim() }, `${THEMES[picked.agent].name} rebuilt the step`)) setChange("");
                }}
              >
                <input
                  value={change}
                  onChange={(e) => setChange(e.target.value)}
                  maxLength={200}
                  placeholder={`Change this step, e.g. “${picked.proposal.action?.kind === "itinerary" ? "max 4 hours a day" : picked.proposal.action ? "make it half the size" : "also check silver"}”`}
                  aria-label="Change this step"
                  className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 text-sm outline-none focus:border-ink/40"
                  data-testid="plan-change"
                />
                <Button type="submit" variant="ghost" className="h-10" disabled={Boolean(busy) || change.trim().length < 2}>
                  {busy === "change" ? <Spinner /> : null} Rebuild
                </Button>
                <Button type="button" variant="quiet" className="h-10 text-bad" disabled={Boolean(busy) || steps.length <= 1} onClick={() => act("remove", "plan-edit", { op: "remove", step: picked.id }, "Step removed")} data-testid="plan-remove">
                  {busy === "remove" ? <Spinner /> : null} Remove
                </Button>
              </form>
            </div>
          )}
          {plan.status !== "proposed" && (picked.status === "failed" || picked.status === "skipped") && (
            <div className="mt-3">
              <Button variant="ghost" className="h-9" disabled={Boolean(busy)} onClick={() => act("retry", "plan-retry", { step: picked.id }, "Trying that step again")} data-testid="plan-retry">
                {busy === "retry" ? <Spinner /> : <Icon name="refund" size={15} />} Try this step again
              </Button>
            </div>
          )}
        </div>
      )}

      {editable && (
        <form
          className="flex flex-wrap items-center gap-2 border-t border-[#f1f0ec] px-4 py-3 sm:px-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (addText.trim().length < 4) return;
            if (await act("add", "plan-edit", { op: "add", agent: addAgent, brief: addText.trim(), after: picked ? [picked.id] : [] }, "Step added")) setAddText("");
          }}
          data-testid="plan-add"
        >
          <input
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            maxLength={260}
            placeholder={picked ? `Add a step after step ${n(picked.id)}…` : "Add a step: say what should happen…"}
            aria-label="Add a step"
            className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-ink/40"
            data-testid="plan-add-input"
          />
          <select value={addAgent} onChange={(e) => setAddAgent(e.target.value as "auto" | AgentId)} aria-label="Who does it" className="h-10 rounded-lg border border-line bg-surface px-2 text-[13px]">
            <option value="auto">Auto</option>
            {(Object.keys(THEMES) as AgentId[]).map((a) => (
              <option key={a} value={a}>
                {THEMES[a].name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="ghost" className="h-10" disabled={Boolean(busy) || addText.trim().length < 4}>
            {busy === "add" ? <Spinner /> : <Icon name="plus" size={15} />} Add step
          </Button>
        </form>
      )}

      {plan.unavailable.length > 0 && (
        <ul className="space-y-0.5 border-t border-[#f1f0ec] px-4 py-3 text-[12.5px] sm:px-5" data-testid="plan-unavailable">
          {plan.unavailable.map((u) => (
            <li key={u.what} className="text-ink-2">
              <span className="font-medium text-bad">Can&apos;t do here:</span> {u.what}. <span className="text-ink-3">{u.why}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#f1f0ec] px-4 py-3 sm:px-5">
        <span className="num text-[13px] text-ink-2">
          {total > 0 ? `At most $${total < 0.01 ? usdc(total) : total.toFixed(2)} across ${steps.length} steps` : `${steps.length} steps, nothing to pay`}
          {editable ? " · click a step to change it" : ""}
        </span>
        {editable && (
          <Button onClick={() => act("start", "plan-start", { planId: plan.id }, "Plan started · each step runs as its own job")} disabled={Boolean(busy)} variant="agent" className="h-10 px-5" data-testid="start-plan">
            {busy === "start" ? <Spinner /> : null} Start plan
          </Button>
        )}
        {plan.status === "running" && (
          <Button onClick={() => act("stop", "plan-stop", {})} disabled={Boolean(busy)} variant="danger" className="h-10" data-testid="stop-plan">
            {busy === "stop" ? <Spinner /> : null} Stop
          </Button>
        )}
      </div>
    </section>
  );
}
