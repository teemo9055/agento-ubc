import { aiJson, SHARED_RULES, Summary, type AiUsage } from "../ai";
import * as gemini from "../gemini";
import type { AgentId } from "@/lib/types";


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

/** Model writes the headline and a few findings from computed results. */
export async function aiSummary(agent: AgentId, task: string, facts: unknown): Promise<{ summary: Summary; usage: AiUsage } | null> {
  const r = await aiJson(Summary, {
    name: `${agent}_summary`,
    system: `${SHARED_RULES}\nWrite the result for the user: a one-line headline answering their task, then up to 4 short findings. Use only numbers present in the DATA, rounded sensibly (e.g. 124 km, 2.1 h, 37 pts). Say plainly when data is thin. Report what the agent did (order placed, skipped and why); don't urge further trades.`,
    user: `TASK: ${task}\n\nDATA (computed results):\n${JSON.stringify(facts).slice(0, 12_000)}`,
    maxTokens: 2000,
  });
  return r ? { summary: r.value, usage: r.usage } : null;
}

export { marketCandidates, spotSymbols };
