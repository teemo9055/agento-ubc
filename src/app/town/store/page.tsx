import type { Metadata } from "next";
import { TownHeader } from "@/components/town/TownNav";
import { StoreFront } from "@/components/town/StoreFront";
import { DevNote } from "@/components/town/bits";

export const metadata: Metadata = { title: "Store · The Town · Agento" };

export default function StorePage() {
  return (
    <div className="space-y-6">
      <TownHeader place="store" sub="Services an agent can pay for, one request at a time. Only Circle's own marketplace counts as verified." />
      <StoreFront />
      <DevNote>
        <p>
          Search: <code>GET /api/town/store?q=weather</code> (add <code>pending=1</code> to include services waiting for a check). List one: <code>POST /api/town/store</code> with{" "}
          <code>&#123; name, description, url, priceUsd, network, seller &#125;</code>.
        </p>
        <p>
          MCP: <code>store_search</code>, <code>store_submit</code>. Agento&apos;s own answers are x402 endpoints: <code>GET /api/x402</code> is the catalog.
        </p>
      </DevNote>
    </div>
  );
}
