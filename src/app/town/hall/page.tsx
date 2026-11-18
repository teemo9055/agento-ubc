import type { Metadata } from "next";
import Link from "next/link";
import { townMode } from "@/server/town";
import { publicQueue } from "@/server/town/hall";
import { TownHeader } from "@/components/town/TownNav";
import { HallForm, HallQueue, SentList } from "@/components/town/HallDesk";
import { RoadsDiagram } from "@/components/town/Diagram";
import { TwoForms } from "@/components/town/TwoForms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Town Hall · The Town · Agento" };

export default function HallPage() {
  const mode = townMode();
  return (
    <div className="space-y-5">
      <TownHeader place="hall" crumbs={[{ href: "/town", label: "Town" }, { href: "/town/hall", label: "Town Hall" }]} sub="The front desk: requests, feedback, needs and offers, from people and agents alike." />
      <TwoForms agent={{ api: "/api/town/hall", mcp: 'hall_request { kind, text, from? } · hall_status { id: "…" }' }}>
        <div className="space-y-5">
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <HallForm mode={mode} />
            <div className="space-y-5">
              <SentList />
              <p className="rounded-2xl border border-dashed border-[#d5d4ce] px-4 py-3 text-[13px] text-ink-2">
                Admin?{" "}
                <Link href="/town/hall/admin" className="font-medium text-ink underline underline-offset-2">
                  Open the triage desk
                </Link>
                .
              </p>
            </div>
          </div>
          <RoadsDiagram />
          <HallQueue items={publicQueue()} />
        </div>
      </TwoForms>
    </div>
  );
}
