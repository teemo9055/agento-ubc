"use client";
import Link from "next/link";
import { Icon } from "./Icon";
import { Glyph, recipeGlyph } from "./Recipes";
import { Spinner } from "./ui";
import { useStartJob } from "./useStartJob";
import { matchRecipes, recipeById, type Recipe } from "@/lib/recipes";
import { THEMES } from "@/lib/themes";
import type { Run } from "@/lib/types";

/**
 * What a recipe-shaped job usually leads to: the recipes it lists as next, or failing that the
 * closest ones from the other agents. This is how people find out what else is possible: one
 * relevant idea at the moment it's useful, not a catalogue.
 */
export function nextFor(run: Pick<Run, "task" | "agent">): Recipe[] {
  const best = matchRecipes(run.task, { limit: 1 })[0]?.recipe;
  const listed = (best?.next ?? []).map(recipeById).filter((r): r is Recipe => Boolean(r));
  if (listed.length) return listed.slice(0, 2);
  return matchRecipes(run.task, { limit: 6 })
    .map((m) => m.recipe)
    .filter((r) => r.agent !== run.agent && r.id !== best?.id)
    .slice(0, 2);
}

/** The finished job's last section: what could come next. */
export function NextSteps({ run }: { run: Run }) {
  const { start, busy } = useStartJob();
  const next = run.status === "done" ? nextFor(run) : [];
  if (!next.length) return null;
  return (
    <section className="flex flex-col gap-4" aria-label="What's next" data-testid="next-steps">
      {next.length > 0 && (
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">People who did this often do next</h2>
            <Link href="/recipes" className="text-[13px] font-medium underline underline-offset-2">
              More in the recipe book
            </Link>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {next.map((r) => (
              <li key={r.id} data-agent={r.agent}>
                <button type="button" onClick={() => void start(r.agent, r.say, r.id)} disabled={Boolean(busy)} className="pressable group flex w-full items-center gap-3 rounded-2xl border border-line bg-panel p-3 text-left hover:border-ink disabled:opacity-60" data-testid="next-recipe">
                  <span className="pix-shadow inline-flex shrink-0 rounded-xl border-[1.5px] border-ink bg-agent-soft p-1.5">
                    <Glyph name={recipeGlyph(r)} size={26} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11.5px] font-semibold uppercase tracking-wide text-agent-ink">{THEMES[r.agent].name}</span>
                    <span className="block text-[14px] font-semibold leading-snug">{r.worry}</span>
                    <span className="block truncate text-[12.5px] text-ink-3">{r.title}</span>
                  </span>
                  {busy === r.id ? <Spinner /> : <Icon name="arrow" size={15} className="shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
