import { z } from "zod";
import { aiJson, CardCopy, EditReply, SHARED_RULES, Summary, type AiUsage } from "../ai";
import * as gemini from "../gemini";
import type { AgentId } from "@/lib/types";
import type { EditResult } from "./types";

type Opts = Record<string, unknown>;
export interface AiPlanResult {
  options: Opts;
  usage: AiUsage;
}

const BASE = process.env.GEMINI_API_BASE ?? "https://api.gemini.com";

// ---------- candidate lists (free menus the model picks from) ----------

async function marketCandidates(task: string) {
  const words = [...new Set((task.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !["the", "and", "how", "what", "have", "odds", "markets", "market", "moved", "this", "week", "today", "track", "which", "most"].includes(w)))].slice(0, 6);
  const lists = await Promise.allSettled([gemini.searchEvents("", 150), ...words.map((w) => gemini.searchEvents(w, 12)), ...words.map((w) => gemini.searchEvents(w.toUpperCase(), 12))]);
  const all = new Map<string, gemini.MarketEvent>();
  for (const l of lists) if (l.status === "fulfilled") for (const e of l.value) if (e.contracts.length) all.set(e.ticker, e);
  return [...all.values()];
}

let symbolsCache: { at: number; list: string[] } | null = null;
async function spotSymbols() {
  if (symbolsCache && Date.now() - symbolsCache.at < 3_600_000) return symbolsCache.list;
  const r = await fetch(`${BASE}/v1/symbols`, { cache: "no-store" });
  const all = (await r.json()) as string[];
  const list = all.filter((s) => /^[a-z0-9]+usd$/.test(s) && !/(gusd|rlusd)$/.test(s) && !s.startsWith("gemi"));
  symbolsCache = { at: Date.now(), list };
  return list;
}

// ---------- per-agent schemas ----------

const InsoPlan = z.object({
  eventTickers: z.array(z.string()).min(1).max(5),
  markets: z.number().int().min(1).max(5),
  tape: z.boolean(),
  timeframe: z.enum(["5m", "15m", "1hr"]),
  cards: CardCopy,
});
const TradoPlan = z.object({
  symbols: z.array(z.string()).min(1).max(3),
  odds: z.boolean(),
  cards: CardCopy,
});
const TravoPlan = z.object({
  stops: z.array(z.string().min(2).max(60)).min(2).max(6),
  hoursPerDay: z.number().int().min(2).max(12),
  cards: CardCopy,
});

const LIMITS: Record<AgentId, string> = {
  inso: [
    "Agent: Inso, prediction-market analyst. Read-only: it never places trades.",
    "Products: load one event (0.01 USDC each), odds history per chosen contract (0.02), trade tape per contract (0.10, optional, shows buyer vs seller flow).",
    "Choose 1-5 events from the CANDIDATES by ticker, how many contracts to analyse in total (1-5), whether the trade tape is worth it, and the candle timeframe.",
    "Pick events that actually answer the task. Prefer fewer purchases when the task is narrow.",
  ].join("\n"),
  trado: [
    "Agent: Trado, spot trend reader. Read-only: it never places orders.",
    "Products: hourly and daily candles per coin (0.02 each, two per coin), plus optional prediction-market odds per coin (0.03).",
    "Choose 1-3 symbols from SYMBOLS and whether related prediction-market odds add value.",
  ].join("\n"),
  travo: [
    "Agent: Travo, driving-trip planner. It plans routes; it never books anything.",
    "Products: find a place (0.005 each) and one driving route (0.03).",
    "Extract the ordered stops (2-6 real place names, start first, end last) and max driving hours per day (2-12, default 6).",
  ].join("\n"),
};

const CARD_RULES = "Write card copy for this specific task: deliverableTitle (2-4 words), deliverablePoints (what the user gets, 2-4 items), riskPoints (honest limits, 2-3 items).";

async function context(agent: AgentId, task: string) {
  if (agent === "inso") {
    const events = await marketCandidates(task);
    const lines = events
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 100)
      .map((e) => `${e.ticker} | ${e.title} | ${e.category} | vol ${Math.round(e.volume)} | ${e.contracts.length} contracts`);
    return { text: `CANDIDATES (ticker | title | category | volume | contracts):\n${lines.join("\n")}`, events };
  }
  if (agent === "trado") {
    const syms = await spotSymbols();
    return { text: `SYMBOLS: ${syms.join(" ")}`, syms };
  }
  return { text: "" };
}

function toOptions(agent: AgentId, v: unknown, ctx: Awaited<ReturnType<typeof context>>): Opts | null {
  if (agent === "inso") {
    const p = v as z.infer<typeof InsoPlan>;
    const events = (ctx.events ?? []).filter((e) => p.eventTickers.includes(e.ticker));
    if (!events.length) return null;
    return { events: events.map((e) => ({ ticker: e.ticker, title: e.title })), markets: p.markets, tape: p.tape, tf: p.timeframe, cards: p.cards };
  }
  if (agent === "trado") {
    const p = v as z.infer<typeof TradoPlan>;
    const symbols = p.symbols.map((s) => s.toLowerCase()).filter((s) => ctx.syms?.includes(s));
    if (!symbols.length) return null;
    return { symbols: [...new Set(symbols)], odds: p.odds, cards: p.cards };
  }
  const p = v as z.infer<typeof TravoPlan>;
  return { stops: p.stops.map((s) => s.trim()), hoursPerDay: p.hoursPerDay, cards: p.cards };
}

const SCHEMA = { inso: InsoPlan, trado: TradoPlan, travo: TravoPlan } as const;

/** Model drafts the plan options from the task; code validates and prices them. */
export async function aiPlan(agent: AgentId, task: string): Promise<AiPlanResult | null> {
  const ctx = await context(agent, task).catch(() => null);
  if (!ctx) return null;
  const r = await aiJson(SCHEMA[agent], {
    name: `${agent}_plan`,
    system: `${SHARED_RULES}\n${LIMITS[agent]}\n${CARD_RULES}`,
    user: `TASK (from the user): ${task}\n\nDATA:\n${ctx.text}`,
  });
  if (!r) return null;
  const options = toOptions(agent, r.value, ctx);
  return options ? { options, usage: r.usage } : null;
}

/** Model applies a card edit, or explains why not; code validates the new options. */
export async function aiEdit(agent: AgentId, task: string, card: string, prompt: string, current: Opts): Promise<(EditResult & { usage: AiUsage }) | null> {
  const ctx = await context(agent, `${task} ${prompt}`).catch(() => null);
  if (!ctx) return null;
  const schema = z.object({ reply: EditReply, plan: SCHEMA[agent].nullable() });
  const r = await aiJson(schema, {
    name: `${agent}_edit`,
    system: `${SHARED_RULES}\n${LIMITS[agent]}\n${CARD_RULES}\nThe user is editing the "${card}" card of an existing plan. If the change is possible within the limits, set reply.ok=true, a short reply.message saying what changed, and plan = the full updated plan. If not, reply.ok=false, plan=null, reply.message says plainly why, and reply.alternatives lists 1-3 short edits that ARE possible, phrased as instructions the user could send.`,
    user: `TASK: ${task}\nCURRENT PLAN: ${JSON.stringify({ ...current, cards: undefined })}\nEDIT REQUEST (from the user): ${prompt}\n\nDATA:\n${ctx.text}`,
  });
  if (!r) return null;
  const { reply, plan } = r.value;
  if (!reply.ok || !plan) return { ok: false, message: reply.message, alternatives: reply.alternatives.length ? reply.alternatives : undefined, usage: r.usage };
  const options = toOptions(agent, plan, ctx);
  if (!options) return { ok: false, message: "That change didn't match anything available.", alternatives: reply.alternatives, usage: r.usage };
  return { ok: true, message: reply.message, options, usage: r.usage };
}

/** Model writes the headline and a few findings from computed results. */
export async function aiSummary(agent: AgentId, task: string, facts: unknown): Promise<{ summary: Summary; usage: AiUsage } | null> {
  const r = await aiJson(Summary, {
    name: `${agent}_summary`,
    system: `${SHARED_RULES}\nWrite the result for the user: a one-line headline answering their task, then up to 4 short findings. Use only numbers present in the DATA, rounded sensibly (e.g. 124 km, 2.1 h, 37 pts). Say plainly when data is thin. No advice to trade or bet.`,
    user: `TASK: ${task}\n\nDATA (computed results):\n${JSON.stringify(facts).slice(0, 12_000)}`,
    maxTokens: 2000,
  });
  return r ? { summary: r.value, usage: r.usage } : null;
}

/** Validates a plan written by an outside AI (MCP). Same rules as the built-in planner. */
export async function validateExternalPlan(agent: AgentId, plan: unknown): Promise<{ options: Opts } | { error: string }> {
  const parsed = SCHEMA[agent].safeParse(plan);
  if (!parsed.success) return { error: `Plan invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  let ctx: Awaited<ReturnType<typeof context>>;
  if (agent === "inso") {
    const tickers = (parsed.data as z.infer<typeof InsoPlan>).eventTickers;
    const found = await Promise.allSettled(tickers.map((t) => gemini.getEvent(t)));
    const events = found.flatMap((f) => (f.status === "fulfilled" && f.value.contracts.length ? [f.value] : []));
    const missing = tickers.filter((t) => !events.some((e) => e.ticker === t));
    if (missing.length) return { error: `Unknown or inactive event tickers: ${missing.join(", ")}. Use browse_options to find real ones.` };
    ctx = { text: "", events };
  } else ctx = await context(agent, "");
  const options = toOptions(agent, parsed.data, ctx);
  return options ? { options } : { error: "Plan names symbols or places that aren't available. Use browse_options." };
}

export { marketCandidates, spotSymbols };
