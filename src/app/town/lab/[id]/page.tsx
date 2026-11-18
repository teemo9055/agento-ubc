import type { Metadata } from "next";
import { ThreadPage } from "@/components/town/ThreadPage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lab thread · The Town · Agento" };

export default async function LabThreadPage({ params }: { params: Promise<{ id: string }> }) {
  return <ThreadPage which="lab" id={(await params).id} />;
}
