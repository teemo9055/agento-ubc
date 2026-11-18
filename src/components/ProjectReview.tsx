"use client";
import type { Plan } from "@/lib/types";
import { getsLine } from "@/lib/plain";
import { lookupCost, maxCost } from "@/lib/move";
import { THEMES } from "@/lib/themes";

const money = (x: number) => `$${x > 0 && x < 0.01 ? x.toFixed(4) : x.toFixed(2)}`;
const num = (id: string) => id.replace(/^s/, "");

/**
 * One review for a whole project: the same four answers a single job gets (what you get, how, the
 * limits and the price), totalled across its jobs, with what happens to the rest when one fails.
 */
export function ProjectReview({ plan }: { plan: Plan }) {
  const steps = plan.steps;
  const lookups = steps.flatMap((s) => s.proposal.research.map((r) => ({ step: s, label: r.label, cost: lookupCost(r) })));
  const data = lookups.reduce((a, l) => a + l.cost, 0);
  const orders = steps.reduce((a, s) => a + maxCost(s.proposal.action), 0);
  const waits = steps.filter((s) => (s.after ?? []).length > 0);
  const cards: { title: string; sub: string; body: React.ReactNode }[] = [
    {
      title: "Outcome",
      sub: "What you receive",
      body: (
        <ol className="space-y-1 text-[13px] leading-snug">
          {steps.map((s) => (
            <li key={s.id} className="flex gap-2">
              <span className="num shrink-0 text-ink-3">{num(s.id)}.</span>
              <span className="min-w-0">{s.proposal.action ? getsLine(s.proposal).label : s.proposal.title}</span>
            </li>
          ))}
        </ol>
      ),
    },
    {
      title: "Execution",
      sub: "Paid per request",
      body: (
        <ul className="space-y-1 text-[13px] leading-snug">
          {steps.map((s) => (
            <li key={s.id} className="flex justify-between gap-2">
              <span className="min-w-0">
                <span className="font-medium" style={{ color: `var(--${s.agent}-ink, inherit)` }}>{THEMES[s.agent].name}</span> <span className="text-ink-2">{s.proposal.title}</span>
              </span>
            </li>
          ))}
        </ul>
      ),
    },
    {
      title: "Risk & safeguards",
      sub: "If something goes wrong",
      body: (
        <ul className="space-y-1.5 text-[13px] leading-snug" data-testid="project-limits">
          {waits.map((s) => (
            <li key={s.id}>
              <span className="font-semibold">If step {(s.after ?? []).map(num).join(" or ")} fails:</span>{" "}
              <span className="text-ink-2">
                step {num(s.id)} is skipped{s.gate === "filled" ? ", and it also waits for that order to fill" : ""}{s.useProceeds ? "; it only spends what that sale brought in" : ""}.
              </span>
            </li>
          ))}
          <li>
            <span className="font-semibold">Starting it:</span> <span className="text-ink-2">each job is approved for you when its turn comes, never above the amounts shown. You can stop all of it at any point.</span>
          </li>
        </ul>
      ),
    },
  ];
  return (
    <section className="space-y-3" aria-label="Review the project" data-testid="project-review">
      <ol className="grid gap-x-3 gap-y-4 md:grid-cols-3">
        {cards.map((c, i) => (
          <li key={c.title} className="flex min-w-0 flex-col">
            <div className="mb-2 flex items-center gap-2" aria-hidden>
              <span className={`num inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] text-[11px] font-semibold border-[1.5px] border-[#d5d4ce] bg-panel text-ink-2`}>{i + 1}</span>
              <span className="whitespace-nowrap text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">{c.sub}</span>
              {i < cards.length - 1 && <span className="hidden h-px flex-1 border-t border-dashed border-[#c9c8c2] md:block" />}
            </div>
            <div className="flex-1 rounded-2xl border border-line bg-panel p-3.5">
              <h3 className="mb-2 text-[15px] font-semibold leading-tight">{c.title}</h3>
              {c.body}
            </div>
          </li>
        ))}
      </ol>
      {/* The cost, itemized per job, with the maximum total: each number once. */}
      <section className="rounded-2xl border border-line bg-panel px-4 py-3" aria-label="Cost">
        <h3 className="text-[15px] font-semibold">Cost</h3>
        <div className="mt-1 divide-y divide-[#f1f0ec]">
          {steps.map((s) => {
            const cost = maxCost(s.proposal.action) + s.proposal.research.reduce((a, r) => a + lookupCost(r), 0);
            return (
              <div key={s.id} className="flex items-baseline justify-between gap-3 py-1.5 text-[13.5px]">
                <span className="min-w-0 text-ink-2">
                  {num(s.id)}. {s.proposal.title} <span className="text-ink-3">· {THEMES[s.agent].name}</span>
                </span>
                <span className="num shrink-0">{cost > 0 ? money(cost) : "Free"}</span>
              </div>
            );
          })}
          <div className="flex items-baseline justify-between gap-3 pt-2.5">
            <span className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">Maximum total</span>
            <span className="num text-[20px] font-semibold" data-testid="project-most">
              {money(data + orders)}
            </span>
          </div>
        </div>
      </section>
    </section>
  );
}
