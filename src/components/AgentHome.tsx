"use client";
import { useState } from "react";
import Link from "next/link";
import { Mascot } from "./Mascot";
import { Icon } from "./Icon";
import { Button, Spinner } from "./ui";
import { useAgentTheme } from "./useRun";
import { useRuns } from "./runsStore";
import { useStartJob } from "./useStartJob";
import { TradeBoard } from "./AgentSheets";
import { Band, Card } from "./JobCard";
import { RecipeCard } from "./Recipes";
import { matchRecipes, RECIPES } from "@/lib/recipes";
import { THEMES } from "@/lib/themes";
import type { AgentId } from "@/lib/types";

const ASK: Record<AgentId, { ask: string; placeholder: string; buildsTitle: string }> = {
  inso: { ask: "What do you want to protect?", placeholder: "e.g. my rides cost double when it snows", buildsTitle: "Problems Inso solves" },
  trado: { ask: "What are you trying to trade today?", placeholder: "e.g. buy $10 of ETH if it dips 2%", buildsTitle: "Worries people bring to Trado" },
  worko: { ask: "Where are you driving?", placeholder: "e.g. plan a drive from Austin to Denver in 3 days", buildsTitle: "Trips Worko plans" },
};

/**
 * An agent's own home: how it starts (the problems it solves, as recipes; Trado also shows the
 * trading board), and your jobs with it. Picking anything opens a
 * job, where that agent shapes it with you; every job then shares the same review, graph and receipt.
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
  const mine = (runs ?? []).filter((r) => r.agent === agent && !r.parentId).slice(0, 6);

  return (
    <div className="flex flex-col gap-6" data-agent={agent} data-testid={`agent-home-${agent}`}>
      <Band single />
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4">
          <span className="pix-shadow inline-flex rounded-xl border-[1.5px] border-ink bg-agent-soft p-1.5">
            <Mascot agent={agent} mood="happy" size={64} />
          </span>
          <div className="min-w-0">
            <h1 className="font-pixel text-[30px] leading-tight text-agent-ink sm:text-[34px]">{t.name}</h1>
            <p className="text-[14px] text-ink-2">{t.domain}</p>
          </div>
        </div>
      </header>

      <form
        className="rounded-2xl border-[1.5px] border-ink bg-panel p-4 shadow-[4px_4px_0_0_var(--agent)] sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void start(agent, text, "ask");
        }}
      >
        <label htmlFor="agent-ask" className="block text-[20px] font-semibold leading-tight sm:text-[22px]">
          {s.ask}
        </label>
        <div className="mt-3 flex gap-2">
          <input id="agent-ask" value={text} onChange={(e) => setText(e.target.value)} placeholder={s.placeholder} maxLength={1000} className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 text-[15px] outline-none focus:border-ink/50" data-testid="agent-ask" />
          <Button type="submit" variant="agent" className="h-12 px-5" disabled={text.trim().length < 3 || Boolean(busy)}>
            {busy === "ask" ? <Spinner /> : <Icon name="send" size={16} />} Ask
          </Button>
        </div>
        {closest && (
          <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-2" data-testid="closest-recipe" data-agent={closest.agent}>
            <span className="font-semibold text-ink">Close to a recipe:</span> {closest.worry}
            {closest.agent !== agent && <span className="text-ink-3">(with {THEMES[closest.agent].name})</span>}
            <button type="button" onClick={() => void start(closest.agent, `${text.trim()}. ${closest.say}`, closest.id)} className="pressable inline-flex h-7 items-center rounded-full border border-ink px-2.5 text-[12px] font-semibold hover:bg-ink hover:text-white">
              Start from it
            </button>
          </p>
        )}
        {err && (
          <p className="mt-2 text-[13px] text-bad" role="alert">
            {err}
          </p>
        )}
      </form>

      <section aria-labelledby="builds">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <h2 id="builds" className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">
            {s.buildsTitle}
          </h2>
          <Link href={`/recipes?agent=${agent}`} className="text-[13px] font-medium underline underline-offset-2">
            The whole recipe book
          </Link>
        </div>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recipes.map((r) => (
            <RecipeCard key={r.id} r={r} busy={busy === r.id} onStart={(x) => void start(x.agent, x.say, x.id)} />
          ))}
        </ul>
      </section>

      {agent === "trado" && (
        <section aria-labelledby="board">
          <h2 id="board" className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
            Your trading
          </h2>
          <TradeBoard />
        </section>
      )}

      <section aria-labelledby="yours">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="yours" className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">
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
