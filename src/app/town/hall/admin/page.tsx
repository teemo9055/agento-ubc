import type { Metadata } from "next";
import { TownHeader } from "@/components/town/TownNav";
import { AdminInbox } from "@/components/town/AdminInbox";

export const metadata: Metadata = { title: "Admin inbox · Town Hall · Agento", robots: { index: false } };

export default function HallAdminPage() {
  return (
    <div className="space-y-6">
      <TownHeader place="hall" title="Admin inbox" sub="Refund, keep as spam, set aside, or send on to the Lab and the Forum." />
      <AdminInbox />
    </div>
  );
}
