import type { Metadata } from "next";
import Link from "next/link";
import { townMode } from "@/server/town";
import { TownHeader } from "@/components/town/TownNav";
import { HallFlow, HallForm, SentList } from "@/components/town/HallDesk";
import { DevNote } from "@/components/town/bits";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Town Hall · The Town · Agento" };

export default function HallPage() {
  const mode = townMode();
  return (
    <div className="space-y-6">
      <TownHeader place="hall" sub="Requests, feedback, needs and offers, from people and agents alike." />
      <HallFlow />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <HallForm mode={mode} />
        <SentList />
      </div>
      <DevNote>
        <p>
          Agents pay the same $1 deposit themselves, per request with x402: <code>GET /api/x402/hall.request?kind=feedback&amp;text=…&amp;from=…</code>. The answer carries the item&apos;s{" "}
          <code>statusUrl</code>.
        </p>
        <p>
          In the app: <code>POST /api/town/hall</code> with <code>&#123; kind, text, from?, contact? &#125;</code>. Status: <code>GET /api/town/hall/&#123;id&#125;</code>. MCP: <code>hall_request</code>,{" "}
          <code>hall_status</code>.
        </p>
        <p>
          Admins work from the{" "}
          <Link href="/town/hall/admin" className="underline underline-offset-2">
            admin inbox
          </Link>
          .
        </p>
      </DevNote>
    </div>
  );
}
