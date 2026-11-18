"use client";
import type { Brief, Plan, Proposal, Run } from "@/lib/types";
import { HELP_LABEL, mainnetOn, type Help } from "@/lib/network";
import { lookupCost, maxCost, usdc } from "@/lib/move";
import { Icon } from "./Icon";

const CHIP: Record<Help, string> = {
  now: "bg-good/10 text-good border-good/30",
  partly: "bg-warn/10 text-warn-ink border-warn/40",
  mainnet: "bg-agent/10 text-agent-ink border-agent/30",
  no: "bg-transparent text-ink-3 border-line",
};

/** The latest brief, when it is still what the conversation is about. */
export function briefOf(run: Run): { brief: Brief; plan?: Plan; proposal?: Proposal } | undefined {
  const last = [...(run.chat ?? [])].reverse().find((m) => m.brief || m.plan || m.proposal);
  return last?.brief ? { brief: last.brief, plan: last.plan, proposal: last.proposal } : undefined;
}

const cost = (p: Proposal) => p.research.reduce((s, r) => s + lookupCost(r), 0) + maxCost(p.action);
const money = (x: number) => (x <= 0 ? "nothing" : `$${x < 0.01 ? usdc(x) : x.toFixed(2)}`);

/**
 * For someone who brought a problem, not an order: what the agent understood, each thing behind
 * the problem with how much of it can be taken on, and what the proposed work costs and leaves open.
 */
export function BriefCard({ brief, plan, proposal }: { brief: Brief; plan?: Plan; proposal?: Proposal }) {
  const steps = plan?.steps.map((s) => s.proposal) ?? (proposal ? [proposal] : []);
  const total = steps.reduce((s, p) => s + cost(p), 0);
  const titleOf = (id?: string) => (plan && id ? plan.steps.find((s) => s.id === id)?.proposal.title : proposal?.title);
  const handled = brief.drivers.filter((d) => d.help === "now" || d.help === "partly").length;
  return (
    <section className="rounded-2xl border-[1.5px] border-ink bg-panel shadow-[3px_3px_0_0_var(--agent)]" aria-label="What I'd do about it" data-testid="brief-card">
      <div className="border-b border-[#f1f0ec] px-4 py-3 sm:px-5">
        <div className="font-pixel text-[12px] text-agent-ink">What I understood</div>
        <p className="mt-1 text-[16px] font-semibold leading-snug" data-testid="brief-understood">
          {brief.understood}
        </p>
      </div>
      <ol className="divide-y divide-[#f1f0ec]" data-testid="brief-drivers">
        {brief.drivers.map((d) => {
          // A line that was waiting for mainnet reads as available the moment the switch is on.
          const help: Help = d.help === "mainnet" && mainnetOn() ? "now" : d.help;
          return (
            <li key={d.what} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 sm:px-5" data-testid="brief-driver" data-help={help}>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold leading-snug">{d.what}</div>
                <div className="text-[13px] leading-snug text-ink-2">{d.how}</div>
                {d.step && titleOf(d.step) && (
                  <div className="mt-0.5 flex items-center gap-1 text-[12.5px] text-ink-3">
                    <Icon name="arrow" size={12} /> {plan ? `Step ${d.step.slice(1)}: ` : ""}
                    {titleOf(d.step)}
                  </div>
                )}
              </div>
              <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[11.5px] font-semibold ${CHIP[help]}`}>{HELP_LABEL[help]}</span>
            </li>
          );
        })}
      </ol>
      <div className="border-t border-[#f1f0ec] px-4 py-3 sm:px-5">
        <p className="num text-[13.5px] text-ink" data-testid="brief-total">
          {steps.length
            ? `${steps.length} job${steps.length === 1 ? "" : "s"} for ${handled} of ${brief.drivers.length} · at most ${money(total)}`
            : "Nothing here would change this, so there is nothing to set up."}
        </p>
        {brief.leftOpen && (
          <p className="mt-1 text-[13px] text-ink-2" data-testid="brief-open">
            <span className="font-semibold">Still open:</span> {brief.leftOpen}
          </p>
        )}
      </div>
    </section>
  );
}
