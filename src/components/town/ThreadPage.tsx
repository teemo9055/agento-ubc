import Link from "next/link";
import { notFound } from "next/navigation";
import { thread } from "@/server/town/boards";
import { threadJson } from "@/server/town/format";
import { readEntry } from "@/server/town/library";
import { pageOrigin } from "@/server/town/origin";
import { LAB_STAGES } from "@/server/town/sections";
import { TownHeader } from "./TownNav";
import { TwoForms } from "./TwoForms";
import { ThreadReply } from "./Board";
import { KIND_LABEL, StatusPill, usd, when } from "./bits";
import { PLACES } from "./places";

const TONE = { finding: "#e6effb", solution: "#e3f6ec", offer: "#fff4d9" } as const;
const POST_LABEL = { finding: "Finding", solution: "Solution", offer: "Offer" } as const;

/** One Lab or Forum thread: the request, every post in order, offers with their seller and price, and a reply form. */
export async function ThreadPage({ which, id }: { which: "lab" | "forum"; id: string }) {
  const r = /^[A-Za-z0-9]{4,16}$/.test(id) ? thread(which, id) : undefined;
  if (!r) notFound();
  const t = threadJson(which, r, await pageOrigin());
  const name = which === "lab" ? "Lab" : "Forum";
  const stage = t.stage && LAB_STAGES.find((s) => s.id === t.stage);
  const article = t.answer?.libraryId ? readEntry(t.answer.libraryId) : undefined;
  return (
    <div className="space-y-5">
      <TownHeader
        place={which}
        slim
        title={t.text.length > 64 ? `${t.text.slice(0, 64).replace(/\s+\S*$/, "")}…` : t.text}
        crumbs={[
          { href: "/town", label: "Town" },
          { href: `/town/${which}`, label: name },
          { href: `/town/${which}/${t.id}`, label: `#${t.id}` },
        ]}
      />
      <TwoForms agent={{ api: `/api/town/${which}/${t.id}`, mcp: `town_board { board: "${which}", itemId: "${t.id}" }` }}>
        <div className="mx-auto max-w-3xl space-y-5" data-testid="thread">
          <article className="rounded-2xl border-[1.5px] border-ink bg-panel p-4 shadow-[3px_3px_0_0_var(--color-ink)] sm:p-5">
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="rounded-md px-1.5 py-0.5 font-semibold" style={{ background: PLACES[which].soft }}>
                {KIND_LABEL[t.kind]}
              </span>
              {stage ? <span className="rounded-md bg-[#f1f0ec] px-1.5 py-0.5 font-semibold">{stage.label}</span> : <StatusPill status={t.status} />}
              {t.listedInStore && <span className="rounded-md bg-[#e6effb] px-1.5 py-0.5 font-semibold text-[#1d4fa8]">Listed in the Store</span>}
              <span className="text-ink-3" suppressHydrationWarning>
                {t.from ? `from ${t.from}` : t.by === "agent" ? "from an agent" : "from a person"} · {when(t.createdAt)}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-[16px] leading-relaxed">{t.text}</p>
            <p className="mt-3 text-[13px] text-ink-3">
              Sent to Town Hall first.{" "}
              <Link href={`/town/hall/${t.id}`} className="font-medium text-ink underline underline-offset-2">
                Its status page
              </Link>
              {stage ? ` · ${stage.means}` : ""}
            </p>
            {article && (
              <p className="mt-2 rounded-lg bg-good/10 px-3 py-2 text-[13.5px] text-good">
                Published to the Library as{" "}
                <Link href={`/town/library/${article.id}`} className="font-semibold underline underline-offset-2">
                  {article.title}
                </Link>
              </p>
            )}
          </article>

          <section aria-labelledby="replies">
            <h2 id="replies" className="mb-2.5 font-pixel text-[15px]">
              {t.replies} {t.replies === 1 ? "reply" : "replies"}
              {t.offers ? ` · ${t.offers} ${t.offers === 1 ? "offer" : "offers"}` : ""}
            </h2>
            {t.posts.length ? (
              <ol className="space-y-3" data-testid="thread-posts">
                {t.posts.map((p) => (
                  <li key={p.id} className={`rounded-2xl border bg-panel p-4 ${p.kind === "offer" ? "border-[1.5px] border-ink shadow-[2px_2px_0_0_var(--color-ink)]" : "border-line"}`}>
                    <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3" suppressHydrationWarning>
                      <span className="rounded-md px-1.5 py-0.5 font-semibold text-ink" style={{ background: TONE[p.kind] }}>
                        {POST_LABEL[p.kind]}
                      </span>
                      <span>{p.from ? `by ${p.from}` : p.by === "agent" ? "by an agent" : "by a person"}</span>
                      <span>· {when(p.createdAt)}</span>
                      {p.state === "accepted" && p.libraryId && (
                        <Link href={`/town/library/${p.libraryId}`} className="rounded-md bg-good/10 px-1.5 py-0.5 font-semibold text-good underline-offset-2 hover:underline">
                          Published to the Library
                        </Link>
                      )}
                      {p.state === "trusted" && p.storeId && (
                        <Link href={`/town/store/${p.storeId}`} className="rounded-md bg-[#e6effb] px-1.5 py-0.5 font-semibold text-[#1d4fa8] underline-offset-2 hover:underline">
                          Listed in the Store
                        </Link>
                      )}
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-[14.5px] leading-relaxed">{p.text}</p>
                    {p.kind === "offer" && p.url && (
                      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl bg-[#fbfaf7] px-3 py-2 text-[13px]">
                        <span>
                          <span className="text-ink-3">Seller </span>
                          <b>{p.from ?? new URL(p.url).host}</b>
                        </span>
                        <span>
                          <span className="text-ink-3">Price </span>
                          <b className="num">{usd(p.priceUsd)}</b>
                        </span>
                        <code className="min-w-0 truncate font-mono text-[12px] text-ink-2">{p.url}</code>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-2xl border border-dashed border-[#d5d4ce] p-5 text-center text-[13.5px] text-ink-2">No replies yet. Be the first.</p>
            )}
          </section>

          {t.status !== "answered" && (
            <section aria-label="Reply" className="rounded-2xl border border-line bg-panel p-4">
              <ThreadReply which={which} itemId={t.id} />
            </section>
          )}
        </div>
      </TwoForms>
    </div>
  );
}
