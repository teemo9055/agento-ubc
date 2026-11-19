"use client";
import { useState } from "react";
import type { ChatTiers, TierChoice } from "@/lib/types";
import { ComposeFunnel } from "./ComposeFunnel";
import { post } from "./useRun";
import { toast } from "./Toaster";

const money = (x: number) => `$${x > 0 && x < 0.01 ? x.toFixed(4) : x.toFixed(2)}`;

const BLURB: Record<TierChoice["tier"], string> = {
  quick: "Only what you must know, cheapest way",
  thorough: "Everything worth knowing",
  certain: "Key answers checked by a second source",
};

/**
 * The composer's plans side by side. Picking one swaps the plan shown, by code, with no model call.
 * A plan that can't run on this network is shown greyed, with why.
 */
export function TierPicker({ tiers, onPick, busy }: { tiers: ChatTiers; onPick?: (t: TierChoice["tier"]) => void; busy?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Plans" className="grid gap-2.5 sm:grid-cols-3" data-testid="tier-picker">
      {tiers.options.map((t) => {
        const on = tiers.selected === t.tier;
        const gaps = tiers.gaps.filter((g) => !t.answers.some((a) => a.question === g.fact));
        return (
          <button
            key={t.tier}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={busy || !onPick}
            onClick={() => onPick?.(t.tier)}
            className={`pressable flex min-w-0 flex-col rounded-xl border p-3 text-left transition-[border-color,box-shadow] ${on ? "border-[1.5px] border-ink bg-panel shadow-[3px_3px_0_0_var(--agent)]" : "border-line bg-panel hover:border-ink/60"} ${t.runnable ? "" : "opacity-70"}`}
            data-testid={`tier-${t.tier}`}
            data-runnable={t.runnable ? "true" : "false"}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[14.5px] font-semibold">{t.label}</span>
              <span className="num shrink-0 text-[12.5px] text-ink-2" data-testid={`tier-${t.tier}-cost`}>
                At most {money(t.cost)}
              </span>
            </div>
            <span className="mt-0.5 text-[12px] text-ink-3">
              {t.steps} step{t.steps === 1 ? "" : "s"} · {BLURB[t.tier]}
            </span>
            <ul className="mt-2 space-y-1 text-[12.5px] leading-snug">
              {t.answers.map((a) => (
                <li key={a.id} className="flex items-start gap-1.5">
                  <span aria-hidden className="mt-[1px] text-good">
                    ✓
                  </span>
                  <span className="min-w-0">
                    {a.question}
                    {a.crossChecked && (
                      <span className="ml-1 inline-block rounded-[4px] bg-agent-soft px-1 text-[10.5px] font-semibold text-agent-ink" data-testid="cross-checked">
                        cross-checked
                      </span>
                    )}
                  </span>
                </li>
              ))}
              {gaps.slice(0, 2).map((g) => (
                <li key={g.fact} className="flex items-start gap-1.5 text-ink-3">
                  <span aria-hidden className="mt-[1px]">
                    –
                  </span>
                  <span className="min-w-0">
                    {g.fact} <span className="text-[11.5px]">({g.why.toLowerCase()})</span>
                  </span>
                </li>
              ))}
            </ul>
            {!t.runnable && <span className="mt-2 text-[11.5px] font-medium text-warn-ink">{t.why ?? "Can't run here"}: switch to Arc mainnet in Settings</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The latest plans the composer offered in this job's chat. */
export const tiersOf = (run: import("@/lib/types").Run) => [...(run.chat ?? [])].reverse().find((m) => m.tiers)?.tiers;

/** Funnel plus picker, for the shaping and review stages. Picking a plan is a quick change: code only. */
export function ComposePanel({ run }: { run: import("@/lib/types").Run }) {
  const tiers = tiersOf(run);
  const [busy, setBusy] = useState(false);
  if (!tiers) return null;
  const pick = (tier: TierChoice["tier"]) => {
    if (tier === tiers.selected) return;
    setBusy(true);
    post(`/api/runs/${run.id}/tier`, { tier })
      .catch((e) => toast((e as Error).message, "bad"))
      .finally(() => setBusy(false));
  };
  return (
    <div className="space-y-2.5" data-testid="compose-panel">
      <ComposeFunnel trace={tiers.trace} plans={tiers.options.length} />
      <TierPicker tiers={tiers} onPick={["exploring", "draft"].includes(run.status) ? pick : undefined} busy={busy} />
    </div>
  );
}
