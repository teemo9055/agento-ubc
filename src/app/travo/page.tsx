import type { Metadata } from "next";
import { AgentHome } from "@/components/AgentHome";

export const metadata: Metadata = { title: "Travo · Agento" };

/** Travo's own home: how it starts, and your jobs with it. */
export default function Page() {
  return <AgentHome agent="travo" />;
}
