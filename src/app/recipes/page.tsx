"use client";
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Band } from "@/components/JobCard";
import { RecipeCard, RecipeKey } from "@/components/Recipes";
import { useAgentTheme } from "@/components/useRun";
import { useStartJob } from "@/components/useStartJob";
import { matchRecipes, MOMENTS, RECIPES, type Moment } from "@/lib/recipes";
import { AGENT_LIST, THEMES } from "@/lib/themes";
import type { AgentId } from "@/lib/types";

/**
 * The recipe book: combinations that solve everyday problems, grouped by the moment in life they
 * belong to. Describe your own problem and the closest recipes come first; pick one and the agent
 * tailors it with you before anything is paid.
 */
function Book() {
  const params = useSearchParams();
  const router = useRouter();
  const agent = (params.get("agent") as AgentId | null) ?? null;
  const moment = (params.get("moment") as Moment | null) ?? null;
  const [q, setQ] = useState("");
  const { start, busy, err } = useStartJob();
  useAgentTheme(agent ?? "worko");

  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace(`/recipes${p.size ? `?${p}` : ""}`, { scroll: false });
  };

  const list = RECIPES.filter((r) => (!agent || r.agent === agent) && (!moment || r.moment === moment));
  const matched = useMemo(() => (q.trim().length >= 3 ? matchRecipes(q, { agent: agent ?? undefined, limit: 6 }).map((m) => m.recipe) : null), [q, agent]);
  const groups = (Object.keys(MOMENTS) as Moment[]).map((m) => ({ m, items: list.filter((r) => r.moment === m) })).filter((g) => g.items.length);
  const go = (r: (typeof RECIPES)[number]) => void start(r.agent, q.trim().length >= 3 ? `${q.trim()}. ${r.say}` : r.say, r.id);

  const chip = (on: boolean) => `pressable inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors ${on ? "border-ink bg-ink text-white" : "border-line bg-panel text-ink hover:border-ink"}`;

  return (
    <div className="flex flex-col gap-6" data-testid="recipe-book">
      <Band />
      <header className="max-w-2xl">
        <h1 className="font-pixel text-[30px] leading-tight sm:text-[34px]">Recipe book</h1>
        <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">
          Most problems are a few small jobs put together. Each recipe is one that works: start from it, and the agent tailors it to you. You still see every step and its price before anything is paid.
        </p>
      </header>

      <form
        className="rounded-2xl border-[1.5px] border-ink bg-panel p-4 shadow-[4px_4px_0_0_var(--agent)]"
        onSubmit={(e) => {
          e.preventDefault();
          const best = matched?.[0];
          if (best) go(best);
        }}
      >
        <label htmlFor="recipe-q" className="block text-[18px] font-semibold leading-tight">
          What&apos;s the problem?
        </label>
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-surface px-3 focus-within:border-ink/50">
          <Icon name="search" size={16} className="text-ink-3" />
          <input id="recipe-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. a cold snap would ruin my BBQ on Saturday" className="h-12 w-full bg-transparent text-[15px] outline-none" data-testid="recipe-search" />
        </div>
        <p className="mt-2 text-[12.5px] text-ink-3">{matched ? (matched.length ? "Closest recipes first. Nothing fits? Start a job and the agent builds one for you." : "No recipe fits yet.") : "Describe it in your own words; the closest recipes come up."}</p>
        {matched && !matched.length && (
          <Link href="/new" className="mt-2 inline-flex h-9 items-center rounded-lg border border-ink px-3 text-[13px] font-semibold hover:bg-ink hover:text-white">
            Build one from scratch
          </Link>
        )}
        {err && (
          <p className="mt-2 text-[13px] text-bad" role="alert">
            {err}
          </p>
        )}
      </form>

      <div className="flex flex-col gap-2.5">
        <nav aria-label="Agents" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <button type="button" onClick={() => set("agent", null)} className={chip(!agent)}>
            Every agent
          </button>
          {AGENT_LIST.map((a) => (
            <button key={a} type="button" data-agent={a} onClick={() => set("agent", agent === a ? null : a)} className={chip(agent === a)}>
              <span aria-hidden className="h-2 w-2 rounded-[2px] bg-agent" /> {THEMES[a].name}
              <span className="text-[12px] opacity-70">{THEMES[a].domain}</span>
            </button>
          ))}
        </nav>
        <nav aria-label="Moments" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <button type="button" onClick={() => set("moment", null)} className={chip(!moment)}>
            All moments
          </button>
          {(Object.keys(MOMENTS) as Moment[]).map((m) => (
            <button key={m} type="button" onClick={() => set("moment", moment === m ? null : m)} className={chip(moment === m)}>
              {MOMENTS[m].label}
            </button>
          ))}
        </nav>
        <RecipeKey />
      </div>

      {matched?.length ? (
        <section aria-labelledby="closest">
          <h2 id="closest" className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
            Closest to your problem
          </h2>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {matched.map((r) => (
              <RecipeCard key={r.id} r={r} showAgent busy={busy === r.id} onStart={go} />
            ))}
          </ul>
        </section>
      ) : (
        groups.map((g) => (
          <section key={g.m} aria-labelledby={`m-${g.m}`}>
            <div className="mb-3">
              <h2 id={`m-${g.m}`} className="text-[18px] font-semibold">
                {MOMENTS[g.m].label}
              </h2>
              <p className="text-[13px] text-ink-3">{MOMENTS[g.m].blurb}</p>
            </div>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((r) => (
                <RecipeCard key={r.id} r={r} showAgent busy={busy === r.id} onStart={go} />
              ))}
            </ul>
          </section>
        ))
      )}
      {!matched && !groups.length && <p className="text-center text-[14px] text-ink-2">No recipes for that mix yet.</p>}
    </div>
  );
}

export default function RecipesPage() {
  return (
    <Suspense>
      <Book />
    </Suspense>
  );
}
