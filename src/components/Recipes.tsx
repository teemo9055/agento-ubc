"use client";
import { Spinner } from "./ui";
import { THEMES } from "@/lib/themes";
import { KIND_TEXT, recipeCost, type Recipe, type RecipeStep } from "@/lib/recipes";

/** Small pixel pictures, 8×8, drawn in the agent's colour. */
const GLYPH: Record<string, string[]> = {
  ticket: ["........", "########", "#..##..#", "#......#", "#......#", "#..##..#", "########", "........"],
  shop: ["........", "########", "#.#.#.##", "########", "#......#", "#.##.#.#", "#.##...#", "########"],
  plane: ["...##...", "...##...", "..####..", "########", "########", "...##...", "..####..", "........"],
  rain: ["..####..", ".######.", "########", "........", ".#..#..#", "#..#..#.", ".#..#..#", "........"],
  crash: ["#.......", "##......", "#.#.....", "#..#..#.", "#...##.#", "#......#", "#.......", "########"],
  cold: ["...#....", "..###...", "...#....", "...#....", "...#....", "..###...", ".#####..", "..###..."],
  coin: ["..####..", ".#....#.", "#..##..#", "#.#..#.#", "#.#..#.#", "#..##..#", ".#....#.", "..####.."],
  car: ["........", "..####..", ".#....#.", "########", "########", "#.####.#", ".#....#.", "........"],
  bed: ["........", "#.......", "#.##....", "#.######", "########", "#......#", "#......#", "........"],
  food: ["#.#.#..#", "#.#.#.##", "#####.##", "..#..###", "..#...##", "..#....#", "..#....#", "........"],
  map: ["...##...", "..#..#..", "..#..#..", "...##...", "...##...", "...##...", "....#...", "........"],
  shield: ["########", "#......#", "#.####.#", "#.#..#.#", "#.####.#", ".#....#.", "..#..#..", "...##..."],
  house: ["...##...", "..####..", ".######.", "########", ".#....#.", ".#.##.#.", ".#.##.#.", ".######."],
  tool: ["##....##", "###..###", ".######.", "..####..", "..####..", ".##..##.", "##....##", "#......#"],
  tag: ["....####", "...#...#", "..#..#.#", ".#.....#", "#.....#.", "#....#..", ".#..#...", "..##...."],
  case: ["..####..", "..#..#..", "########", "#......#", "########", "#......#", "#......#", "########"],
  chart: ["#.......", "#....##.", "#...#..#", "#..#....", "#.#.....", "##......", "#.......", "########"],
  sun: ["...#....", "#..#..#.", ".#####..", "##...##.", ".#...#..", ".#####..", "#..#..#.", "...#...."],
  bank: ["...##...", "..####..", ".######.", "........", ".#.#.#.#", ".#.#.#.#", ".#.#.#.#", "########"],
};

const GLYPH_OF: Record<string, string> = {
  "road-trip": "map",
  "ev-trip": "car",
  "stay-nearby": "bed",
  "coin-check": "coin",
  "gas-check": "chart",
  "wallet-check": "bank",
  "whats-coming": "chart",
  "ticket-cover": "ticket",
  "event-weather": "cold",
  "rate-hike": "bank",
  "crash-cover": "crash",
  "ride-weather": "cold",
  "business-costs": "shop",
};

export function Glyph({ name, size = 32 }: { name: string; size?: number }) {
  const rows = GLYPH[name] ?? GLYPH.coin;
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden className="shrink-0">
      {rows.flatMap((r, y) => [...r].map((c, x) => (c === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="var(--agent)" /> : null)))}
    </svg>
  );
}

export const recipeGlyph = (r: Recipe) => GLYPH_OF[r.id] ?? "coin";

const money = (x: number) => (x === 0 ? "Free" : x < 0.01 ? `$${x.toFixed(4).replace(/0+$/, "")}` : `$${x.toFixed(2)}`);

/** One step of a recipe as a small chip: who does it, shown by its look, and what it costs. */
function StepChip({ s, n }: { s: RecipeStep; n: number }) {
  const look = s.kind === "free" ? "border-line bg-[#f6f5f1]" : "border-line bg-panel";
  const right = s.kind === "pays" ? money(s.cost ?? 0) : s.kind === "agent" ? s.by : "Free";
  return (
    <li className={`flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-[12.5px] ${look}`} data-kind={s.kind} title={`${KIND_TEXT[s.kind]} · ${s.by}`}>
      <span className="num w-3.5 shrink-0 text-center text-[11px] text-ink-3">{n}</span>
      <span className="min-w-0 flex-1 truncate">{s.label}</span>
      <span className={`num shrink-0 text-[11.5px] ${s.kind === "agent" ? "font-semibold" : "text-ink-3"}`} data-agent={s.kind === "agent" ? agentOf(s.by) : undefined} style={s.kind === "agent" ? { color: "var(--agent-ink)" } : undefined}>
        {right}
      </span>
    </li>
  );
}

const agentOf = (name: string) => (Object.entries(THEMES).find(([, t]) => t.name === name)?.[0] as string | undefined) ?? undefined;

/**
 * A recipe as a card: the worry in the person's words, the steps it combines (each showing who
 * does it and what it costs), what comes back, and a Start button that opens a job from it.
 */
export function RecipeCard({ r, onStart, busy, showAgent = false }: { r: Recipe; onStart: (r: Recipe) => void; busy?: boolean; showAgent?: boolean }) {
  const cost = recipeCost(r);
  return (
    <li className="flex min-w-0" data-agent={r.agent}>
      <article className="flex w-full flex-col rounded-2xl border border-line bg-panel p-3 transition-colors hover:border-ink" data-testid="recipe" data-recipe={r.id}>
        <div className="flex items-start gap-3">
          <span className="pix-shadow inline-flex shrink-0 rounded-xl border-[1.5px] border-ink bg-agent-soft p-2">
            <Glyph name={recipeGlyph(r)} size={30} />
          </span>
          <div className="min-w-0 flex-1">
            {showAgent && <div className="text-[11.5px] font-semibold uppercase tracking-wide text-agent-ink">{THEMES[r.agent].name}</div>}
            <h3 className="text-[15px] font-semibold leading-snug">{r.worry}</h3>
            <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">{r.title}</p>
          </div>
        </div>
        <ol className="mt-3 flex flex-col gap-1" aria-label="Steps">
          {r.steps.map((s, i) => (
            <StepChip key={s.label} s={s} n={i + 1} />
          ))}
        </ol>
        <p className="mt-2.5 text-[12.5px] leading-snug text-ink-2">
          <span className="font-semibold text-ink">You get:</span> {r.gets}
        </p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="num text-[12px] text-ink-3">{cost > 0 ? `about ${money(cost)} a run` : "Free to check"}</span>
          </div>
          <button type="button" onClick={() => onStart(r)} disabled={busy} className="pressable inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border-[1.5px] border-ink bg-agent px-3.5 text-[12.5px] font-semibold text-agent-on shadow-[2px_2px_0_0_var(--color-ink)] disabled:opacity-60" data-testid="recipe-start">
            {busy ? <Spinner /> : null} Start
          </button>
        </div>
      </article>
    </li>
  );
}

/** The key to the step chips, shown once above a list of recipes. */
export function RecipeKey() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-2" aria-label="How to read a recipe">
      <li className="flex items-center gap-1.5">
        <span className="h-3 w-5 rounded-[4px] border border-line bg-panel" /> Agento pays per request
      </li>
      <li className="flex items-center gap-1.5">
        <span className="h-3 w-5 rounded-[4px] border border-line bg-[#f6f5f1]" /> Free
      </li>
    </ul>
  );
}
