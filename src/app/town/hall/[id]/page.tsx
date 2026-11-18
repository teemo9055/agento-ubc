import Link from "next/link";
import { notFound } from "next/navigation";
import { getItem, publicView, ROUTE_LABEL } from "@/server/town/hall";
import { readEntry } from "@/server/town/library";
import { getListing } from "@/server/town/listings";
import { txUrl } from "@/lib/format";
import { TownHeader } from "@/components/town/TownNav";
import { TwoForms } from "@/components/town/TwoForms";
import { KIND_LABEL, StatusPill, when } from "@/components/town/bits";
import { CopyLink } from "@/components/town/CopyLink";

export const dynamic = "force-dynamic";

const MEANS: Record<string, string> = {
  received: "Town Hall has it. An admin will read it.",
  refunded: "An admin read it and it isn't spam, so the $1 deposit went back.",
  "kept as spam": "An admin marked it as spam, so the $1 deposit was kept.",
  routed: "It was sent on for others to work on.",
  answered: "It has an answer.",
  abandoned: "An admin set it aside.",
};

export default async function HallItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = getItem(id);
  if (!raw) notFound();
  const i = publicView(raw);
  const entry = i.answer?.libraryId ? readEntry(i.answer.libraryId) : undefined;
  const listing = i.answer?.listingId ? getListing(i.answer.listingId) : undefined;
  const awaiting = i.deposit.state === "awaiting";
  const practice = i.deposit.mode === "practice";
  const title = awaiting ? "Not sent yet" : i.status[0].toUpperCase() + i.status.slice(1);
  return (
    <div className="space-y-5">
      <TownHeader
        place="hall"
        slim
        title={title}
        crumbs={[
          { href: "/town", label: "Town" },
          { href: "/town/hall", label: "Town Hall" },
          { href: `/town/hall/${i.id}`, label: `#${i.id}` },
        ]}
      />
      <TwoForms agent={{ api: `/api/town/hall/${i.id}`, mcp: `hall_status { id: "${i.id}" }` }}>
      <article className="mx-auto max-w-3xl space-y-5" data-testid="hall-status">
        <header className="flex flex-wrap items-center gap-3">
          {!awaiting && <StatusPill status={i.status} />}
          <p className="text-[15px] text-ink-2">{awaiting ? "It will reach Town Hall once its deposit arrives." : MEANS[i.status]}</p>
        </header>

        <div className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">
            {KIND_LABEL[i.kind]}
            {i.from ? ` from ${i.from}` : ""}
            {i.by === "agent" ? " (an agent)" : ""}
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-relaxed">{i.text}</p>
        </div>

        {(entry || listing || i.routes.length > 0 || i.reason) && (
          <dl className="divide-y divide-[#f1f0ec] rounded-2xl border border-line bg-panel text-[14px]">
            {entry && (
              <div className="flex flex-wrap justify-between gap-2 px-4 py-3">
                <dt className="text-ink-3">Answer</dt>
                <dd>
                  <Link href={`/town/library/${entry.id}`} className="font-medium underline underline-offset-2">
                    {entry.title}
                  </Link>{" "}
                  in the Library
                </dd>
              </div>
            )}
            {listing && (
              <div className="flex flex-wrap justify-between gap-2 px-4 py-3">
                <dt className="text-ink-3">Answer</dt>
                <dd>
                  <Link href={`/town/store/listing-${listing.id}`} className="font-medium underline underline-offset-2">
                    {listing.name}
                  </Link>{" "}
                  is listed in the Store
                </dd>
              </div>
            )}
            {i.routes.length > 0 && (
              <div className="flex flex-wrap justify-between gap-2 px-4 py-3">
                <dt className="text-ink-3">Sent to</dt>
                <dd className="flex gap-3">
                  {i.routes.map((r) => (
                    <Link key={r} href={`/town/${r}/${i.id}`} className="font-medium underline underline-offset-2">
                      The {ROUTE_LABEL[r]}
                    </Link>
                  ))}
                </dd>
              </div>
            )}
            {i.reason && (
              <div className="flex flex-wrap justify-between gap-2 px-4 py-3">
                <dt className="text-ink-3">Why it was set aside</dt>
                <dd>{i.reason}</dd>
              </div>
            )}
          </dl>
        )}

        <section aria-labelledby="hist">
          <h2 id="hist" className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
            What happened
          </h2>
          <ol className="relative space-y-3 pl-7 text-[14px] before:absolute before:bottom-2 before:left-[9px] before:top-2 before:w-[2px] before:bg-line" data-testid="hall-timeline">
            {i.history.map((h, k) => (
              <li key={k} className="relative">
                <span aria-hidden className={`absolute -left-7 top-0.5 flex h-5 w-5 items-center justify-center rounded-[4px] border-[1.5px] border-ink font-pixel text-[9px] ${k === i.history.length - 1 ? "bg-warn" : "bg-panel"}`}>
                  {k + 1}
                </span>
                <span className="block font-medium">{h.what}</span>
                <span className="text-[12.5px] text-ink-3" suppressHydrationWarning>
                  {when(h.at)}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f6f5f1] px-4 py-3 text-[13px]">
          <span className="flex gap-3">
            {!practice && i.deposit.tx && (
              <>
                <a href={txUrl(i.deposit.tx)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  The $1 payment on Arc
                </a>
              </>
            )}
            {i.deposit.refundTx && (
              <>
                <a href={txUrl(i.deposit.refundTx)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  The refund on Arc
                </a>
              </>
            )}
          </span>
          <CopyLink />
        </div>
      </article>
      </TwoForms>
    </div>
  );
}
