import { openDb, type Db } from "./sqlite";
import { tokens } from "./catalog/search";
import type { ComposeTrace, Proposal, ResearchStep, Run } from "@/lib/types";

/**
 * Learned recipes: a composed job that worked becomes a reusable recipe. What the user gave is
 * replaced with placeholders ({{given.phone}}), so no personal value is ever stored. Success rate
 * and average cost come from real runs only. A recipe goes on sale to other agents once it has
 * worked often enough, and is retired if it stops working.
 */
export interface LearnedRecipe {
  id: string;
  worry: string;
  title: string;
  gets: string;
  facts: ComposeTrace["facts"];
  /** What a buyer has to give, by name and type. */
  needs: { name: string; type: string }[];
  /** Steps with placeholders instead of the user's values; bindings kept. */
  steps: ResearchStep[];
  resources: string[];
  /** Where its steps can be paid: this network today, or Arc mainnet. */
  network: "testnet" | "mainnet";
  avgCostUsd: number;
  successRate: number;
  runs: number;
  successes: number;
  status: "draft" | "promoted" | "retired";
  lastRunAt: string;
  createdAt: string;
  /** Jobs it was learned from, newest last (ids only). */
  from: string[];
}

const PROMOTE_AFTER = () => Number(process.env.RECIPE_PROMOTE_AFTER ?? 2);

let db: Db | null | undefined;
const memory = new Map<string, LearnedRecipe>();

function open(): Db | null {
  if (db !== undefined) return db;
  db = openDb("learned recipes", "CREATE TABLE IF NOT EXISTS learned_recipes (id TEXT PRIMARY KEY, data TEXT NOT NULL, runs INTEGER, successes INTEGER, status TEXT, created_at TEXT, updated_at TEXT)");
  return db;
}

function save(r: LearnedRecipe) {
  memory.set(r.id, r);
  const d = open();
  if (!d) return;
  try {
    d.prepare(
      "INSERT INTO learned_recipes (id, data, runs, successes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, runs = excluded.runs, successes = excluded.successes, status = excluded.status, updated_at = excluded.updated_at",
    ).run(r.id, JSON.stringify(r), r.runs, r.successes, r.status, r.createdAt, new Date().toISOString());
  } catch (e) {
    console.warn("recipe not saved:", (e as Error).message);
  }
}

export function allLearned(): LearnedRecipe[] {
  const d = open();
  if (!d) return [...memory.values()];
  try {
    return (d.prepare("SELECT data FROM learned_recipes ORDER BY updated_at DESC").all() as { data: string }[]).map((r) => JSON.parse(r.data) as LearnedRecipe);
  } catch {
    return [...memory.values()];
  }
}
export const learnedById = (id: string) => allLearned().find((r) => r.id === id);
export const resetLearned = () => memory.clear();

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "recipe";

/** Replaces every value the user gave with its placeholder, in inputs and anywhere else in a step. */
export function template(steps: ResearchStep[], givens: NonNullable<Proposal["givens"]>): ResearchStep[] {
  const entries = Object.entries(givens).filter(([, g]) => g.value.length >= 3);
  const scrub = (s: string) => entries.reduce((acc, [name, g]) => acc.split(g.value).join(`{{given.${name}}}`), s);
  return steps.map((s) => {
    const args = Object.fromEntries(Object.entries(s.args).map(([k, v]) => [k, scrub(v)]));
    return { ...s, args, label: scrub(s.label), why: scrub(s.why) };
  });
}

/** The givens a template still needs. */
export const needsOf = (steps: ResearchStep[], givens: NonNullable<Proposal["givens"]>) => {
  const used = new Set<string>();
  for (const s of steps) for (const m of JSON.stringify(s).matchAll(/\{\{given\.([a-z0-9_]+)\}\}|\$given\.([a-z0-9_]+)/gi)) used.add(m[1] ?? m[2]);
  return [...used].map((name) => ({ name, type: givens[name]?.type ?? "text_query" }));
};

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const similar = (a: string[], b: string[]) => {
  const x = new Set(a.flatMap(tokens));
  const y = new Set(b.flatMap(tokens));
  const inter = [...x].filter((w) => y.has(w)).length;
  return inter / Math.max(1, Math.min(x.size, y.size));
};

/** What a finished composed job means for the recipe book: a new draft, or one more run of a known recipe. */
export function learnFromRun(run: Run): LearnedRecipe | null {
  const p = run.proposal;
  if (!p?.compose || !p.research.length || (run.status !== "done" && run.status !== "cancelled")) return null;
  const must = new Set((run.lanes ?? []).filter((l) => l.importance === "must").map((l) => l.id));
  const mustSteps = run.phases.filter((ph) => ph.lineId && ph.lane && must.has(ph.lane) && !ph.tieBreaker);
  // Worked: not stopped, and every must-know step delivered.
  const success = run.status === "done" && mustSteps.length > 0 && mustSteps.every((ph) => ph.status === "done");
  const cost = run.lines.reduce((a, l) => a + Number(l.actual), 0) / 1e6;
  const resources = [...new Set(p.research.map((r) => r.resource ?? r.args.url).filter(Boolean))];
  const facts = p.compose.facts;
  const known = allLearned().find((r) => sameSet(r.resources, resources) && similar(r.facts.map((f) => f.question), facts.map((f) => f.question)) >= 0.6);
  const now = new Date().toISOString();
  if (known) {
    if (known.from.includes(run.id)) return known;
    const runs = known.runs + 1;
    const successes = known.successes + (success ? 1 : 0);
    const next: LearnedRecipe = {
      ...known,
      runs,
      successes,
      successRate: successes / runs,
      avgCostUsd: (known.avgCostUsd * known.runs + cost) / runs,
      lastRunAt: now,
      from: [...known.from, run.id].slice(-50),
    };
    next.status = statusOf(next);
    save(next);
    return next;
  }
  if (!success) return null;
  const givens = p.givens ?? {};
  const steps = template(p.research, givens);
  const title = p.title.replace(/: (quick|thorough|most certain)$/i, "");
  const taken = new Set(allLearned().map((r) => r.id));
  let id = slug(`${title}${facts[0] ? ` ${facts.length > 1 ? "" : facts[0].question}` : ""}`);
  for (let i = 2; taken.has(id); i++) id = `${slug(title)}-${i}`;
  const r: LearnedRecipe = {
    id,
    worry: facts.find((f) => f.importance === "must")?.question ?? facts[0]?.question ?? title,
    title,
    gets: `Answers: ${facts.filter((f) => f.covered).map((f) => f.question.replace(/\?$/, "").toLowerCase()).join("; ")}`.slice(0, 200),
    facts,
    needs: needsOf(steps, givens),
    steps,
    resources,
    network: run.network === "mainnet" ? "mainnet" : "testnet",
    avgCostUsd: cost,
    successRate: 1,
    runs: 1,
    successes: 1,
    status: "draft",
    lastRunAt: now,
    createdAt: now,
    from: [run.id],
  };
  r.status = statusOf(r);
  save(r);
  return r;
}

function statusOf(r: LearnedRecipe): LearnedRecipe["status"] {
  if (r.runs >= 5 && r.successRate < 0.5) return "retired";
  if (r.successes >= PROMOTE_AFTER() && r.successRate >= 0.75) return "promoted";
  return r.status === "promoted" && r.successRate >= 0.5 ? "promoted" : "draft";
}

/** Promoted recipes closest to a request, by words (a learned recipe's facts and title). */
export function matchLearned(text: string, limit = 2): { recipe: LearnedRecipe; score: number }[] {
  const q = new Set(tokens(text));
  if (!q.size) return [];
  return allLearned()
    .filter((r) => r.status === "promoted")
    .map((recipe) => {
      const words = tokens([recipe.title, recipe.worry, ...recipe.facts.map((f) => f.question)].join(" "));
      const hit = [...new Set(words)].filter((w) => q.has(w)).length;
      return { recipe, score: hit / Math.max(3, q.size) };
    })
    .filter((m) => m.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** The price an outside agent pays: average cost plus a margin, rounded up, never below what its steps may cost. */
export function recipePrice(r: LearnedRecipe): bigint {
  const margin = Number(process.env.RECIPE_MARGIN ?? 0.3);
  const caps = r.steps.reduce((a, s) => a + Number(s.args.price ?? 0), 0);
  const withMargin = Math.ceil(r.avgCostUsd * (1 + margin) * 1000 - 1e-9) * 1000;
  return BigInt(Math.max(withMargin, caps, 1000));
}
