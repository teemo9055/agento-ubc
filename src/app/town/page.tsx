import type { Metadata } from "next";
import { townSummary } from "@/server/town";
import { TownHome } from "@/components/town/TownHome";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "The Town · Agento" };

export default async function TownPage() {
  return <TownHome initial={await townSummary()} />;
}
