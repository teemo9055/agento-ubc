import { z } from "zod";
import type { AgentId } from "@/lib/types";
import { aiJson, FAST_MODEL } from "./ai";
import { agentFor, partsOf } from "./explore";

/**
 * Picks the agent for a request so the user doesn't have to know who does what.
 * Clear cases are decided by rules; the rest by a small, fast model call. Inso is the default
 * because it can also plan across agents.
 */
const Pick = z.object({ agent: z.enum(["inso", "trado", "travo"]) });

export function routeByRules(task: string): AgentId | null {
  const agents = [...new Set(partsOf(task).map(agentFor).filter(Boolean))] as AgentId[];
  // Several agents needed: Inso hosts the plan.
  if (agents.length > 1) return "inso";
  if (agents.length === 1) return agents[0];
  const t = task.toLowerCase();
  if (/\b(hedge|protect|insur|odds|bet|chance|probab|will .+\?)\b/.test(t)) return "inso";
  if (/\b(trade|chart|trend|candle|dip)\b/.test(t)) return "trado";
  if (/\b(trip|drive|route|road)\b/.test(t)) return "travo";
  return null;
}

export async function routeAgent(task: string): Promise<AgentId> {
  const byRule = routeByRules(task);
  if (byRule) return byRule;
  const r = await aiJson(Pick, {
    name: "route",
    model: FAST_MODEL,
    maxTokens: 40,
    system:
      "Pick the agent for a request. inso: prediction markets (odds, bets, hedging a cost, selling positions) and anything that needs several agents. trado: buying or selling a crypto coin at spot, price trends. travo: driving routes and road-trip plans. If unsure, inso.",
    user: task,
  }).catch(() => null);
  return r?.value.agent ?? "inso";
}
