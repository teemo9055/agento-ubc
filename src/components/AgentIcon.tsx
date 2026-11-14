import type { AgentId } from "@/lib/types";
import type { Mood, Outfit } from "@/lib/outfit";
import { Mascot } from "./Mascot";

/** The agent's pixel mascot. "float" in className means the agent is working. */
export function AgentIcon({ agent, size = 40, className = "", outfit, mood }: { agent: AgentId; size?: number; className?: string; outfit?: Outfit; mood?: Mood }) {
  const working = /\bfloat\b/.test(className);
  return <Mascot agent={agent} size={size} outfit={outfit} mood={mood ?? (working ? "working" : "idle")} className={className.replace(/\bfloat\b/, "")} />;
}
