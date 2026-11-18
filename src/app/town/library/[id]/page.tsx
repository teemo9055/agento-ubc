import Link from "next/link";
import { notFound } from "next/navigation";
import { readEntry, SECTIONS } from "@/server/town/library";
import { TownBar } from "@/components/town/TownNav";
import { PlaceIcon } from "@/components/town/places";
import { day } from "@/components/town/bits";

export const dynamic = "force-dynamic";

export default async function LibraryEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = /^[a-z0-9._-]{1,80}$/.test(id) ? readEntry(id) : undefined;
  if (!e) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <TownBar variant="strip" />
      <article className="space-y-5" data-testid="library-entry">
        <header>
          <Link href="/town/library" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink">
            <PlaceIcon place="library" size={16} /> Library · {SECTIONS[e.section]}
          </Link>
          <h1 className="mt-2 font-pixel text-[24px] leading-tight sm:text-[28px]">{e.title}</h1>
          <p className="mt-1 text-[13px] text-ink-3">
            Last updated {day(e.updated)}
            {e.credit && (
              <>
                {" "}
                · answers{" "}
                <Link href={`/town/hall/${e.credit.itemId}`} className="underline underline-offset-2">
                  a Town Hall request
                </Link>
                {e.credit.from ? `, solution by ${e.credit.from}` : ""}
              </>
            )}
          </p>
        </header>

        <p className="text-[16px] leading-relaxed">{e.body}</p>

        <dl className="divide-y divide-[#f1f0ec] rounded-2xl border border-line bg-panel">
          {e.price && (
            <div className="grid gap-1 px-4 py-3 sm:grid-cols-[150px_1fr]">
              <dt className="text-[13px] font-semibold text-ink-3">What it costs</dt>
              <dd className="num text-[14px] font-semibold">{e.price}</dd>
            </div>
          )}
          {e.tool && (
            <div className="grid gap-1 px-4 py-3 sm:grid-cols-[150px_1fr]">
              <dt className="text-[13px] font-semibold text-ink-3">From your AI</dt>
              <dd>
                <code className="block whitespace-pre-wrap break-words rounded-lg bg-[#f6f5f1] px-3 py-2 font-mono text-[12.5px]">{e.tool}</code>
              </dd>
            </div>
          )}
          {e.call && (
            <div className="grid gap-1 px-4 py-3 sm:grid-cols-[150px_1fr]">
              <dt className="text-[13px] font-semibold text-ink-3">The exact call</dt>
              <dd>
                <code className="block whitespace-pre-wrap break-words rounded-lg bg-[#f6f5f1] px-3 py-2 font-mono text-[12.5px]">{e.call}</code>
              </dd>
            </div>
          )}
          <div className="grid gap-1 px-4 py-3 sm:grid-cols-[150px_1fr]">
            <dt className="text-[13px] font-semibold text-ink-3">Where it comes from</dt>
            <dd className="font-mono text-[12.5px] text-ink-2">{e.source}</dd>
          </div>
        </dl>
        <p className="text-[13px] text-ink-3">
          Something missing or wrong?{" "}
          <Link href="/town/hall" className="font-medium text-ink underline underline-offset-2">
            Tell Town Hall
          </Link>
          .
        </p>
      </article>
    </div>
  );
}
