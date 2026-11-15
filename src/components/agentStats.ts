"use client";
import { useMemo } from "react";
import type { AgentId } from "@/lib/types";
import type { RunSummary } from "@/lib/summary";
import { OUTFIT_LABEL, type Outfit } from "@/lib/outfit";
import { useRuns } from "./runsStore";

/** Topic names for the outfits a mascot wears; that's how a job's topic is recorded. */
export const TOPIC: Record<Outfit, string> = {
  sports: "Sports",
  health: "Health",
  crypto: "Crypto",
  commodities: "Commodities",
  weather: "Weather",
  politics: "Politics",
  travel: "Travel",
  finance: "Finance & rates",
  none: "",
};
export { OUTFIT_LABEL };

export interface AgentRecord {
  jobs: RunSummary[];
  done: number;
  running: number;
  /** USDC (6 decimals) the vault paid out across finished jobs, and what came back. */
  spent: bigint;
  returned: bigint;
  /** Topics from finished or running jobs, most common first. */
  topics: { topic: string; outfit: Outfit; count: number }[];
}

/** What an agent has actually done in this app, from the jobs list. */
export function useAgentRecords(): { records: Record<AgentId, AgentRecord> | null } {
  const { runs } = useRuns();
  const records = useMemo(() => {
    if (!runs) return null;
    const empty = (): AgentRecord => ({ jobs: [], done: 0, running: 0, spent: 0n, returned: 0n, topics: [] });
    const out: Record<AgentId, AgentRecord> = { inso: empty(), trado: empty(), travo: empty() };
    const counts: Record<AgentId, Map<Outfit, number>> = { inso: new Map(), trado: new Map(), travo: new Map() };
    for (const r of runs) {
      const rec = out[r.agent];
      if (!rec) continue;
      rec.jobs.push(r);
      if (r.status === "done") rec.done++;
      if (r.status === "running" || r.status === "funding") rec.running++;
      if (r.status === "done" || r.status === "cancelled") {
        rec.spent += BigInt(r.spent || "0");
        rec.returned += BigInt(r.refunded ?? "0");
      }
      if (r.outfit && r.outfit !== "none" && r.status !== "exploring") counts[r.agent].set(r.outfit, (counts[r.agent].get(r.outfit) ?? 0) + 1);
    }
    for (const a of Object.keys(out) as AgentId[]) {
      out[a].jobs.sort((x, y) => Date.parse(y.finishedAt ?? y.createdAt) - Date.parse(x.finishedAt ?? x.createdAt));
      out[a].topics = [...counts[a].entries()].sort((x, y) => y[1] - x[1]).map(([outfit, count]) => ({ outfit, count, topic: TOPIC[outfit] }));
    }
    return out;
  }, [runs]);
  return { records };
}
