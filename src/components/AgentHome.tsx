"use client";
import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Mascot } from "./Mascot";
import { Icon } from "./Icon";
import { Button, Spinner } from "./ui";
import { useAgentTheme } from "./useRun";
import { useRuns } from "./runsStore";
import { useStartJob } from "./useStartJob";
import { TradeBoard } from "./AgentSheets";
import { Band, Card } from "./JobCard";
import { ReadyBadge } from "./Recipes";
import { matchRecipes, recipeCost, RECIPES, type Recipe } from "@/lib/recipes";
import { THEMES } from "@/lib/themes";
import { fmt, sum } from "@/lib/money";
import type { RunSummary } from "@/lib/summary";
import type { AgentId } from "@/lib/types";

const ASK: Record<AgentId, { ask: string; placeholder: string; buildsTitle: string }> = {
  inso: { ask: "What do you want to protect?", placeholder: "e.g. my rides cost double when it snows", buildsTitle: "Problems Inso solves" },
  trado: { ask: "What are you trying to trade today?", placeholder: "e.g. buy $10 of ETH if it dips 2%", buildsTitle: "Worries people bring to Trado" },
  worko: { ask: "What needs doing?", placeholder: "e.g. check this Marketplace seller before I pay", buildsTitle: "Things Worko gets done" },
};

const ORDER: AgentId[] = ["inso", "trado", "worko"];
const WEEK = 7 * 24 * 60 * 60 * 1000;
const usd = (base: bigint) => `$${fmt(base)}`;
const price = (x: number) => (x === 0 ? "Free to check" : `about $${x < 0.01 ? x.toFixed(4).replace(/0+$/, "") : x.toFixed(2)} a run`);
const when = (iso: string) => {
  const d = new Date(iso);
  return Date.now() - d.getTime() < 24 * 60 * 60 * 1000 ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
};

/** One agent's numbers, from your own jobs with it. */
function tally(runs: RunSummary[], agent: AgentId) {
  const mine = runs.filter((r) => r.agent === agent && !r.parentId);
  const week = mine.filter((r) => Date.now() - Date.parse(r.createdAt) < WEEK);
  const needs = mine.filter((r) => r.needsYou > 0).length;
  const running = mine.filter((r) => r.status === "running" || r.status === "funding").length;
  const done = mine.filter((r) => r.status === "done").length;
  return {
    badge: needs ? `${needs} need${needs === 1 ? "s" : ""} you` : running ? `${running} running` : `${done} done`,
    urgent: needs > 0,
    spent: sum(week.map((r) => r.spent)),
    back: sum(week.map((r) => r.refunded)),
    done,
  };
}

/** Engraved lines, like the fine print on a banknote. Decoration only. */
function Engraving() {
  return (
    <svg aria-hidden viewBox="0 0 392 240" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.18]">
      <g fill="none" stroke="currentColor" strokeWidth="0.7">
        {[0, 10, 20, 30, 40].map((d) => (
          <path key={d} d={`M-10 ${168 + d} C 60 ${128 + d}, 120 ${208 + d}, 200 ${168 + d} S 330 ${118 + d}, 410 ${158 + d}`} />
        ))}
        {[70, 58, 46].map((r) => (
          <circle key={r} cx="330" cy="64" r={r} />
        ))}
      </g>
    </svg>
  );
}

/**
 * The agents as a stack of cards, like a wallet. The one you're with sits in front, open:
 * its character where a card's chip would be, and what it spent for you this week.
 */
function AgentCards({ agent, runs }: { agent: AgentId; runs: RunSummary[] }) {
  const stack = [...ORDER.filter((a) => a !== agent), agent];
  return (
    <nav aria-label="Your agents" className="flex flex-col">
      {stack.map((a, i) => {
        const on = a === agent;
        const t = tally(runs, a);
        const cls = `relative block overflow-hidden rounded-[18px] bg-agent px-5 text-agent-on ${i ? "-mt-5" : ""}`;
        const head = (
          <span className="relative flex items-center gap-2.5">
            <span className="font-pixel text-[17px] leading-none">{THEMES[a].name}</span>
            <span className="text-[10.5px] font-medium uppercase tracking-[0.14em] opacity-80">{THEMES[a].domain}</span>
            <span className="flex-1" />
            <span className={`num rounded-md px-2 py-0.5 text-[11.5px] ${t.urgent ? "bg-warn text-ink" : "bg-white/20"}`}>{t.badge}</span>
          </span>
        );
        return on ? (
          <motion.div
            key={a}
            data-agent={a}
            aria-current="page"
            initial={{ y: 16, opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className={`${cls} z-[3] border-[1.5px] border-ink py-5 shadow-[4px_4px_0_0_var(--color-ink)]`}
            data-testid="agent-card"
          >
            <Engraving />
            {head}
            <span className="relative mt-6 flex items-center gap-3.5">
              <span className="inline-flex h-11 w-[54px] items-center justify-center rounded-lg bg-gradient-to-br from-[#f3e7c4] to-[#d9c38b] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.15)]">
                <Mascot agent={a} mood="happy" size={32} framed={false} />
              </span>
              <span className="text-[13px] leading-snug opacity-90">{THEMES[a].tagline}</span>
            </span>
            <span className="relative mt-6 flex items-end gap-7">
              <span>
                <span className="block text-[10.5px] font-medium uppercase tracking-[0.14em] opacity-75">Last 7 days</span>
                <span className="num mt-1 block text-[21px] font-medium">{usd(t.spent)}</span>
              </span>
              <span>
                <span className="block text-[10.5px] font-medium uppercase tracking-[0.14em] opacity-75">Came back</span>
                <span className="num mt-1 block text-[21px] font-medium">{usd(t.back)}</span>
              </span>
              <span className="flex-1" />
              <span className="whitespace-nowrap text-[10.5px] font-medium uppercase tracking-[0.14em] opacity-80">USDC · Arc</span>
            </span>
          </motion.div>
        ) : (
          <Link
            key={a}
            href={`/${a}`}
            data-agent={a}
            style={{ zIndex: i + 1 }}
            className={`${cls} pressable h-[76px] pt-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_16px_-12px_rgba(11,11,11,0.6)] transition-transform duration-300 hover:-translate-y-1.5`}
            title={`Switch to ${THEMES[a].name}`}
          >
            <Engraving />
            {head}
          </Link>
        );
      })}
    </nav>
  );
}

/** What this agent paid for you lately, newest first, like a statement. */
function Statement({ agent, runs, className = "" }: { agent: AgentId; runs: RunSummary[]; className?: string }) {
  const paid = runs
    .filter((r) => r.agent === agent && !r.parentId && BigInt(r.spent || "0") > 0n)
    .sort((a, b) => Date.parse(b.finishedAt ?? b.createdAt) - Date.parse(a.finishedAt ?? a.createdAt))
    .slice(0, 5);
  return (
    <section aria-label={`${THEMES[agent].name}: recent payments`} className={className}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-2">
          {THEMES[agent].name} · recent payments
        </h2>
        <Link href={`/home?folder=${agent}`} className="text-[12.5px] font-medium underline underline-offset-2">
          All jobs
        </Link>
      </div>
      {paid.length ? (
        <ul>
          {paid.map((r) => {
            const back = BigInt(r.refunded || "0");
            return (
              <li key={r.id} className="border-t border-line first:border-ink/80">
                <Link href={`/runs/${r.id}`} className="group flex items-center gap-3 py-3 hover:bg-agent-soft/60">
                  <span className="num w-14 shrink-0 text-[12px] text-ink-2">{when(r.finishedAt ?? r.createdAt)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] group-hover:underline">{r.task}</span>
                    <span className="block truncate text-[12px] text-ink-2">{r.outcome.headline}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="num block text-[13.5px]">−{usd(BigInt(r.spent))}</span>
                    {back > 0n && <span className="num block text-[12px] text-good">+{usd(back)} back</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="border-t border-ink/80 pt-3 text-[13px] leading-relaxed text-ink-2">Nothing paid yet. Asking is free, and nothing is spent until you approve a plan.</p>
      )}
    </section>
  );
}

/** One line of the price list: the worry, a dotted leader, what a run costs. */
function PriceLine({ r, busy, onStart }: { r: Recipe; busy: boolean; onStart: (r: Recipe) => void }) {
  return (
    <li className="group border-b border-line transition-colors hover:bg-agent-soft/50" data-testid="recipe" data-recipe={r.id} data-agent={r.agent}>
      <div className="px-3 py-4">
        <div className="flex items-baseline gap-2.5">
          <h3 className="min-w-0 text-[16px] font-semibold tracking-[-0.01em]">{r.worry}</h3>
          <span aria-hidden className="min-w-6 flex-1 -translate-y-1 border-b-[1.5px] border-dotted border-ink/30" />
          <span className="num whitespace-nowrap text-[14px]">{price(recipeCost(r))}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="min-w-0 flex-1 text-[13.5px] text-ink-2">
            {r.title}. <span className="text-ink">You get:</span> {r.gets}
          </span>
          <ReadyBadge r={r} />
          <button
            type="button"
            onClick={() => onStart(r)}
            disabled={busy}
            className="pressable inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border-[1.5px] border-ink bg-agent px-3.5 text-[12.5px] font-semibold text-agent-on shadow-[2px_2px_0_0_var(--color-ink)] disabled:opacity-60"
            data-testid="recipe-start"
          >
            {busy ? <Spinner /> : null} Start
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * An agent's own home, laid out like a wallet: your agents as cards (switch by picking one),
 * what this one paid for you, a box to ask it for a priced plan, and its price list of recipes.
 * Trado also shows the trading board. Every job then shares the same review, graph and receipt.
 */
export function AgentHome({ agent }: { agent: AgentId }) {
  useAgentTheme(agent);
  const t = THEMES[agent];
  const s = ASK[agent];
  const recipes = RECIPES.filter((r) => r.agent === agent);
  const { start, busy, err } = useStartJob();
  const [text, setText] = useState("");
  const closest = text.trim().length >= 4 ? matchRecipes(text, { limit: 1 })[0]?.recipe : undefined;
  const { runs } = useRuns();
  const all = runs ?? [];
  const mine = all.filter((r) => r.agent === agent && !r.parentId).slice(0, 6);

  return (
    <div className="flex flex-col gap-8" data-agent={agent} data-testid={`agent-home-${agent}`}>
      <Band single />
      <div className="grid items-start gap-10 lg:grid-cols-[380px_minmax(0,1fr)] lg:gap-14">
        <aside className="lg:sticky lg:top-24">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-2">Your agents · pick one to switch</div>
          <AgentCards agent={agent} runs={all} />
          <Statement agent={agent} runs={all} className="mt-8 hidden lg:block" />
        </aside>

        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-agent-ink">{t.domain} desk</div>
          <form
            className="mt-2"
            onSubmit={(e) => {
              e.preventDefault();
              void start(agent, text, "ask");
            }}
          >
            <label htmlFor="agent-ask" className="block max-w-[640px] text-[30px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[38px]">
              {s.ask}
            </label>
            <p className="mt-3 max-w-[580px] text-[15px] leading-relaxed text-ink-2">{t.tagline}</p>
            <div className="ring-agent mt-6 rounded-2xl border border-line bg-panel p-2 pl-4 transition-shadow">
              <div className="flex flex-wrap items-center gap-2">
                <input id="agent-ask" value={text} onChange={(e) => setText(e.target.value)} placeholder={s.placeholder} maxLength={1000} className="h-12 min-w-[200px] flex-1 bg-transparent text-[16px] outline-none" data-testid="agent-ask" />
                <Button type="submit" variant="agent" className="h-11 px-5" disabled={text.trim().length < 3 || Boolean(busy)}>
                  {busy === "ask" ? <Spinner /> : <Icon name="send" size={16} />} Ask for a quote
                </Button>
              </div>
            </div>
            <p className="mt-2.5 px-1 text-[12.5px] text-ink-2">Asking is free. You see every step and its price, and nothing is paid until you approve.</p>
            {closest && (
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[13px] text-ink-2" data-testid="closest-recipe" data-agent={closest.agent}>
                <span className="font-semibold text-ink">Close to a recipe:</span> {closest.worry}
                {closest.agent !== agent && <span className="text-ink-3">(with {THEMES[closest.agent].name})</span>}
                <button type="button" onClick={() => void start(closest.agent, `${text.trim()}. ${closest.say}`, closest.id)} className="pressable inline-flex h-7 items-center rounded-full border border-ink px-2.5 text-[12px] font-semibold hover:bg-ink hover:text-white">
                  Start from it
                </button>
              </p>
            )}
            {err && (
              <p className="mt-2 px-1 text-[13px] text-bad" role="alert">
                {err}
              </p>
            )}
          </form>

          <section aria-labelledby="builds" className="mt-10">
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <h2 id="builds" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-2">
                {s.buildsTitle} · price list
              </h2>
              <Link href={`/recipes?agent=${agent}`} className="text-[13px] font-medium underline underline-offset-2">
                The whole recipe book
              </Link>
            </div>
            <ul className="border-t-[1.5px] border-ink">
              {recipes.map((r) => (
                <PriceLine key={r.id} r={r} busy={busy === r.id} onStart={(x) => void start(x.agent, x.say, x.id)} />
              ))}
            </ul>
            <p className="mt-3 px-1 text-[12.5px] leading-relaxed text-ink-2">A run&apos;s price is what its paid lookups cost. Anything not used comes back to your wallet.</p>
          </section>
          <Statement agent={agent} runs={all} className="mt-10 lg:hidden" />
        </div>
      </div>

      {agent === "trado" && (
        <section aria-labelledby="board">
          <h2 id="board" className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-2">
            Your trading
          </h2>
          <TradeBoard />
        </section>
      )}

      <section aria-labelledby="yours">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="yours" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-2">
            Your jobs with {t.name}
          </h2>
          <Link href={`/home?folder=${agent}`} className="text-[13px] font-medium underline underline-offset-2">
            All of them
          </Link>
        </div>
        {mine.length ? (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mine.map((r) => (
              <Card key={r.id} r={r} />
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-[#d5d4ce] bg-panel/60 p-5 text-center text-[14px] text-ink-2">No jobs with {t.name} yet.</p>
        )}
      </section>
    </div>
  );
}
