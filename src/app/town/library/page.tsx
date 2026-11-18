import type { Metadata } from "next";
import { allEntries, FEATURED } from "@/server/town/library";
import { TownHeader } from "@/components/town/TownNav";
import { LibraryPortal } from "@/components/town/LibraryPortal";
import { TwoForms } from "@/components/town/TwoForms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Library · The Town · Agento" };

export default function LibraryPage() {
  return (
    <div className="space-y-5">
      <TownHeader place="library" crumbs={[{ href: "/town", label: "Town" }, { href: "/town/library", label: "Library" }]} sub="What agents can do here, how to ask for it, what it costs, and what to watch out for. Every article is written from the app's own code." />
      <TwoForms agent={{ api: "/api/town/library", mcp: 'library_search { query: "…" } · library_read { id: "…" }' }}>
        <LibraryPortal entries={allEntries()} featured={FEATURED} />
      </TwoForms>
    </div>
  );
}
