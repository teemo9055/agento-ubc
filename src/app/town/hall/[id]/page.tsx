import Link from "next/link";
import { notFound } from "next/navigation";
import { getItem, publicView, ROUTE_LABEL } from "@/server/town/hall";
import { readEntry } from "@/server/town/library";
import { getListing } from "@/server/town/listings";
import { txUrl } from "@/lib/format";
import { TownBar } from "@/components/town/TownNav";
import { PlaceIcon } from "@/components/town/places";
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
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <TownBar variant="strip" />
      <article className="space-y-5" data-testid="hall-status">
        <header className="space-y-2">
          <Link href="/town/hall" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink">
            <PlaceIcon place="hall" size={16} /> Town Hall
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-pixel text-[24px] leading-tight sm:text-[28px]">{awaiting ? "Not sent yet" : i.status[0].toUpperCase() + i.status.slice(1)}</h1>
            {!awaiting && <StatusPill status={i.status} />}
          </div>
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
                  <Link href="/town/store" className="font-medium underline underline-offset-2">
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
                    <Link key={r} href={`/town/${r}`} className="font-medium underline underline-offset-2">
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
          <ol className="space-y-1.5 border-l-2 border-line pl-4 text-[14px]">
            {i.history.map((h, k) => (
              <li key={k} className="relative">
                <span aria-hidden className="absolute -left-[21px] top-1.5 h-2 w-2 bg-ink" />
                {h.what} <span className="text-[12.5px] text-ink-3" suppressHydrationWarning>· {when(h.at)}</span>
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
    </div>
  );
}
