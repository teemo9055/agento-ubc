import type { Metadata } from "next";
import { ThreadPage } from "@/components/town/ThreadPage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Forum thread · The Town · Agento" };

export default async function ForumThreadPage({ params }: { params: Promise<{ id: string }> }) {
  return <ThreadPage which="forum" id={(await params).id} />;
}
