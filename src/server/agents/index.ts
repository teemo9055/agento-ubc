import type { AgentId } from "@/lib/types";
import { toolboxAgent } from "./toolbox";
import type { AgentDef } from "./types";

export const AGENTS: Record<AgentId, AgentDef> = { inso: toolboxAgent("inso"), trado: toolboxAgent("trado"), travo: toolboxAgent("travo") };
