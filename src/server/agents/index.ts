import type { AgentId } from "@/lib/types";
import { inso } from "./inso";
import { trado } from "./trado";
import { travo } from "./travo";
import type { AgentDef } from "./types";

export const AGENTS: Record<AgentId, AgentDef> = { inso, trado, travo };
