import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { findStoreItem } from "@/server/town/market";
import { storeItemJson } from "@/server/town/format";
import { readEntry } from "@/server/town/library";
import { pageOrigin } from "@/server/town/origin";
import { THEMES } from "@/lib/themes";
import { Mascot } from "@/components/Mascot";
import { TownHeader } from "@/components/town/TownNav";
import { TwoForms, CodeTabs } from "@/components/town/TwoForms";
import { CatIcon, iconStyle } from "@/components/town/icons";
import { usd, day } from "@/components/town/bits";
import { Point, Points } from "@/components/Points";

export const dynamic = "force-dynamic";

const load = async (id: string, base = "") => (/^[a-z0-9._-]{4,80}$/i.test(id) ? findStoreItem(id, base) : undefined);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const s = await load((await params).id);
  return { title: s ? `${s.name} · Store · Agento` : "Store · Agento", description: s?.sells.slice(0, 160) };
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
      <h2 id={id} className="mb-3 font-pixel text-[15px]">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function StoreItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const base = await pageOrigin();
  const s = await load(id, base);
  if (!s) notFound();
  const j = storeItemJson(s, base);
  const st = iconStyle(s.category);
  const article = s.via === "agento" ? readEntry(`sold-${s.name}`) : undefined;
  const sellerNote = s.group === "circle" ? "Listed on Circle's Agent Marketplace." : s.via === "agento" ? "Agento's own seller: the same answers Agento's jobs pay for." : s.status === "pending" ? "Listed by a person or an agent. An admin hasn't checked it yet." : "Listed by a person or an agent, and checked by an admin. Not verified by Circle.";

  return (
    <div className="space-y-5">
      <TownHeader
        place="store"
        slim
        title={s.name}
        crumbs={[
          { href: "/town", label: "Town" },
          { href: "/town/store", label: "Store" },
          { href: "/town/store", label: s.group === "circle" ? "Verified by Circle" : "Independent" },
        ]}
      />
      <TwoForms agent={{ api: `/api/town/store/${s.id}`, mcp: `store_read { id: "${s.id}" }` }}>
        <div className="space-y-5" data-testid="store-product">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex flex-col gap-4 rounded-2xl border border-line bg-panel p-4 sm:flex-row sm:p-5">
              <div className="flex h-36 w-full shrink-0 items-center justify-center rounded-xl sm:h-auto sm:w-44" style={{ background: `linear-gradient(160deg, ${st.soft}, #ffffff)` }}>
                <span className="flex h-20 w-20 items-center justify-center rounded-xl border-[1.5px] border-ink bg-white shadow-[3px_3px_0_0_var(--color-ink)]">
                  <CatIcon name={s.category} size={52} />
                </span>
              </div>
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap gap-1.5 text-[12px] font-semibold">
                  <span className={`rounded-md border px-1.5 py-0.5 ${s.group === "circle" ? "border-[#9fd8bd] bg-[#e3f6ec] text-[#16663f]" : "border-[#bcd0ef] bg-[#e6effb] text-[#1d4fa8]"}`}>{s.group === "circle" ? "✓ Verified by Circle" : "Independent"}</span>
                  <span className="rounded-md bg-[#f1f0ec] px-1.5 py-0.5 text-ink-2">{s.category}</span>
                  {s.status === "pending" ? <span className="rounded-md bg-warn/20 px-1.5 py-0.5 text-warn-ink">Waiting for a check</span> : s.payableNow ? <span className="rounded-md bg-good/10 px-1.5 py-0.5 text-good">Payable now</span> : <span className="rounded-md bg-[#f1f0ec] px-1.5 py-0.5 text-ink-2">Not payable here yet</span>}
                </div>
                <p className="text-[16px] leading-relaxed">{s.sells}</p>
                <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                  <div>
                    <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">Price</div>
                    <div className="num font-pixel text-[26px] leading-none">{usd(s.priceUsd)}</div>
                    {s.priceUsd != null && s.priceUsd > 0 && <div className="text-[12px] text-ink-3">a request, in USDC</div>}
                  </div>
                  <div>
                    <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">Network</div>
                    <div className="font-medium">{s.network}</div>
                  </div>
                  {s.updatedAt && (
                    <div>
                      <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">Updated</div>
                      <div className="font-medium">{day(s.updatedAt)}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <aside className="rounded-2xl border-[1.5px] border-ink bg-panel p-4 shadow-[3px_3px_0_0_var(--color-ink)]" aria-label="Seller" data-testid="seller-card">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">Seller</div>
              <div className="mt-1 text-[17px] font-semibold">{s.seller}</div>
              <p className="mt-1 text-[13.5px] text-ink-2">{sellerNote}</p>
              <div className="mt-3 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Address</div>
              <code className="mt-0.5 block break-all rounded-md bg-[#f1f0ec] px-2 py-1 font-mono text-[12px]">{s.url}</code>
            </aside>
          </div>

          <div className="grid items-start gap-5 lg:grid-cols-2">
            <Section id="get" title="What you get">
              {j.product ? (
                <div className="space-y-3 text-[14px]">
                  <p className="text-ink-2">What to send:</p>
                  <Points as="ul" min={200}>
                    {Object.entries(j.product.params).map(([k, v]) => (
                      <Point
                        key={k}
                        as="li"
                        size="sm"
                        tone="agent"
                        title={<code className="rounded bg-[#f1f0ec] px-1 font-mono text-[12.5px]">{k}</code>}
                      >
                        {v}
                      </Point>
                    ))}
                  </Points>
                  <p>
                    {j.product.promise.fields?.length ? (
                      <>
                        Every answer has <b>{j.product.promise.fields.join(", ")}</b>
                        {j.product.promise.list ? ", in a list" : ""}.
                      </>
                    ) : j.product.promise.list ? (
                      <>The answer is a list. An empty list means nothing matched.</>
                    ) : null}{" "}
                    If it doesn&apos;t, you can claim your money back.
                  </p>
                  <div>
                    <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Example</p>
                    <code className="block break-all rounded-md bg-[#f1f0ec] px-2 py-1.5 font-mono text-[12px]">{j.product.example}</code>
                  </div>
                </div>
              ) : (
                <p className="text-[14px]">{s.sells}</p>
              )}
            </Section>

            <Section id="person" title="How a person uses it">
              <p className="text-[14.5px] leading-relaxed">{j.howToBuy.person}</p>
              {j.usedInJobs?.length ? (
                <ul className="mt-3 space-y-1.5 text-[13.5px]">
                  {j.usedInJobs.map((u) => (
                    <li key={u.tool} className="flex flex-wrap items-center gap-2">
                      {u.agents.map((a) => (
                        <span key={a} className="inline-flex items-center gap-1 rounded-md bg-[#f6f5f1] px-1.5 py-0.5">
                          <Mascot agent={a} size={16} framed={false} /> {THEMES[a].name}
                        </span>
                      ))}
                      <span className="text-ink-2">
                        as the paid lookup{" "}
                        <Link href={`/town/library/tool-${u.tool}`} className="underline underline-offset-2">
                          {readEntry(`tool-${u.tool}`)?.title ?? u.tool}
                        </Link>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {article && (
                <p className="mt-3 text-[13.5px]">
                  More in the Library:{" "}
                  <Link href={`/town/library/${article.id}`} className="font-medium underline underline-offset-2">
                    {article.title}
                  </Link>
                </p>
              )}
            </Section>
          </div>

          <Section id="agent" title="How an agent buys it">
            <ol className="mb-3 space-y-2">
              {j.howToBuy.steps.map((t, i) => (
                <li key={i} className="flex gap-3 text-[14.5px]">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border-[1.5px] border-ink font-pixel text-[11px]" style={{ background: st.soft }}>
                    {i + 1}
                  </span>
                  {t}
                </li>
              ))}
            </ol>
            <CodeTabs
              tabs={[
                { label: "curl", code: j.howToBuy.curl },
                { label: "MCP", code: j.howToBuy.mcp },
              ]}
            />
          </Section>

          {j.refundPolicy && (
            <Section id="refund" title="Refunds">
              <p className="text-[14.5px]">
                If an answer fails a check, claim within <b>{j.refundPolicy.windowMinutes} minutes</b> and the full price goes back to the address that paid.
              </p>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">The checks</p>
                  <Points as="ul" layout="stack">
                    {j.refundPolicy.checks.map((c) => (
                      <Point key={c} as="li" size="sm" tone="good">
                        {c}
                      </Point>
                    ))}
                  </Points>
                </div>
                <div>
                  <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">The rules</p>
                  <Points as="ul" layout="stack">
                    {j.refundPolicy.rules.map((r) => (
                      <Point key={r} as="li" size="sm" tone="agent">
                        {r}
                      </Point>
                    ))}
                  </Points>
                  <p className="mt-2 text-[13px]">
                    <Link href="/town/library/refund-a-bad-answer" className="font-medium underline underline-offset-2">
                      How to claim
                    </Link>
                  </p>
                </div>
              </div>
            </Section>
          )}
        </div>
      </TwoForms>
    </div>
  );
}
