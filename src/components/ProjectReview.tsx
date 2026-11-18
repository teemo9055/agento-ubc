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
              <span className="num shrink-0 text-ink-2">{maxCost(s.proposal.action) + s.proposal.research.reduce((a, r) => a + lookupCost(r), 0) > 0 ? `up to ${money(maxCost(s.proposal.action) + s.proposal.research.reduce((a, r) => a + lookupCost(r), 0))}` : "free"}</span>
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
    {
      title: "Service cost",
      sub: "The jobs' own fees",
      body: (
        <>
          <p className="num text-[18px] font-semibold">{data > 0 ? money(data) : "Free"}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{data > 0 ? `for ${lookups.length} paid ${lookups.length === 1 ? "lookup" : "lookups"} across the jobs. What isn't used comes back.` : "The jobs buy no data."}</p>
        </>
      ),
    },
  ];
  return (
    <section className="space-y-3" aria-label="Review the project" data-testid="project-review">
      <ol className="grid gap-x-3 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c, i) => (
          <li key={c.title} className="flex min-w-0 flex-col">
            <div className="mb-2 flex items-center gap-2" aria-hidden>
              <span className={`num inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] text-[11px] font-semibold ${c.title === "Service cost" ? "bg-agent text-agent-on" : "border-[1.5px] border-[#d5d4ce] bg-panel text-ink-2"}`}>{i + 1}</span>
              <span className="whitespace-nowrap text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">{c.sub}</span>
              {i < cards.length - 1 && <span className="hidden h-px flex-1 border-t border-dashed border-[#c9c8c2] xl:block" />}
            </div>
            <div className={`flex-1 rounded-2xl border border-line p-3.5 ${c.title === "Service cost" ? "bg-agent-soft" : "bg-panel"}`}>
              <h3 className="mb-2 text-[15px] font-semibold leading-tight">{c.title}</h3>
              {c.body}
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-2xl border border-line bg-panel px-4 py-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Maximum total for {steps.length} jobs</div>
          <div className="num text-[20px] font-semibold" data-testid="project-most">
            At most {money(data + orders)}
          </div>
        </div>
        <p className="num text-[13px] text-ink-2">
          {money(data)} for data{orders > 0 ? ` + ${money(orders)} in orders` : ""}
        </p>
      </div>
    </section>
  );
}
