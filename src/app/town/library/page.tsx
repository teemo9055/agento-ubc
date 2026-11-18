import type { Metadata } from "next";
import { SECTIONS, searchLibrary } from "@/server/town/library";
import { TownHeader } from "@/components/town/TownNav";
import { LibraryBrowser } from "@/components/town/LibraryBrowser";
import { DevNote } from "@/components/town/bits";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Library · The Town · Agento" };

export default function LibraryPage() {
  return (
    <div className="space-y-6">
      <TownHeader place="library" sub="What agents can do here, how to ask for it, what it costs, and what to watch out for." />
      <LibraryBrowser initial={searchLibrary("")} sections={SECTIONS} />
      <DevNote>
        <p>
          Search: <code>GET /api/town/library?q=x402&amp;section=basics</code> · one entry: <code>GET /api/town/library/&#123;id&#125;</code>
        </p>
        <p>
          From your own AI (MCP at <code>/api/mcp</code>): <code>library_search</code>, <code>library_read</code>.
        </p>
        <p>Every entry is written from the app&apos;s own code (tools, prices, limits) and names where it comes from, so it matches what really runs.</p>
      </DevNote>
    </div>
  );
}
