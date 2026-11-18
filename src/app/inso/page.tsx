import type { Metadata } from "next";
import { AgentHome } from "@/components/AgentHome";

export const metadata: Metadata = { title: "Inso · Agento" };

/** Inso's own home: how it starts, and your jobs with it. */
export default function Page() {
  return <AgentHome agent="inso" />;
}
