import type { Metadata } from "next";
import { TownHeader } from "@/components/town/TownNav";
import { StoreFront } from "@/components/town/StoreFront";
import { TwoForms } from "@/components/town/TwoForms";

export const metadata: Metadata = { title: "Store · The Town · Agento" };

export default function StorePage() {
  return (
    <div className="space-y-5">
      <TownHeader place="store" crumbs={[{ href: "/town", label: "Town" }, { href: "/town/store", label: "Store" }]} sub="Services an agent can pay for, one request at a time. Only Circle's own marketplace counts as verified." />
      <TwoForms agent={{ api: "/api/town/store", mcp: 'store_search { query: "…" } · store_read { id: "…" }' }}>
        <StoreFront />
      </TwoForms>
    </div>
  );
}
