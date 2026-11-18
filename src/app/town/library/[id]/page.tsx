import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readEntry, SECTIONS } from "@/server/town/library";
import { articleJson } from "@/server/town/format";
import { pageOrigin } from "@/server/town/origin";
import { THEMES } from "@/lib/themes";
import { Mascot } from "@/components/Mascot";
import { TownHeader } from "@/components/town/TownNav";
import { TwoForms, CodeTabs } from "@/components/town/TwoForms";
import { Diagram } from "@/components/town/Diagram";
import { CatIcon, iconStyle } from "@/components/town/icons";
import { day } from "@/components/town/bits";

export const dynamic = "force-dynamic";

const valid = (id: string) => (/^[a-z0-9._-]{1,80}$/.test(id) ? readEntry(id) : undefined);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const e = valid((await params).id);
  return { title: e ? `${e.title} · Library · Agento` : "Library · Agento", description: e?.body.slice(0, 160) };
}

export default async function LibraryArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = valid(id);
  if (!e) notFound();
  const base = await pageOrigin();
  const a = articleJson(e, base);
  const st = iconStyle(e.section);
  const toc = [
    e.diagram && { id: "flow", label: "How it flows" },
    (a.steps?.length || e.tool || a.curl) && { id: "how", label: "How to use it" },
    a.seeAlso.length && { id: "see", label: "See also" },
  ].filter((x): x is { id: string; label: string } => Boolean(x));

  const info: [string, React.ReactNode][] = [
    ["Kind", e.kind],
    ["Category", <Link key="c" href="/town/library" className="underline underline-offset-2">{SECTIONS[e.section]}</Link>],
    ["Price", e.price && <span className="num font-semibold">{e.price}</span>],
    [
      "Agents",
      e.agents?.length ? (
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          {e.agents.map((g) => (
            <span key={g} className="inline-flex items-center gap-1">
              <Mascot agent={g} size={18} framed={false} />
              {THEMES[g].name}
            </span>
          ))}
        </span>
      ) : null,
    ],
    ["MCP tool", a.mcpTool && <code className="rounded bg-[#f1f0ec] px-1 font-mono text-[12px]">{a.mcpTool}</code>],
    ["HTTP", e.call && <code className="break-words font-mono text-[12px]">{e.call.split(" → ")[0].split(" · ")[0]}</code>],
    ["Network", e.network],
    ["Updated", <time key="u" dateTime={e.updated}>{day(e.updated)}</time>],
    ["Source", <code key="s" className="break-words font-mono text-[11.5px] text-ink-2">{e.source}</code>],
    ["In the Store", a.store && <Link href={`/town/store/${a.store.id}`} className="underline underline-offset-2">See it in the Store</Link>],
    ["Answers", e.credit && <Link href={`/town/hall/${e.credit.itemId}`} className="underline underline-offset-2">a Town Hall request{e.credit.from ? `, by ${e.credit.from}` : ""}</Link>],
  ];

  return (
    <div className="space-y-5">
      <TownHeader
        place="library"
        slim
        title={e.title}
        crumbs={[
          { href: "/town", label: "Town" },
          { href: "/town/library", label: "Library" },
          { href: `/town/library#${e.section}`, label: SECTIONS[e.section] },
        ]}
      />
      <TwoForms agent={{ api: `/api/town/library/${e.id}`, mcp: `library_read { id: "${e.id}" }` }}>
        <article className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]" data-testid="library-entry">
          <div className="min-w-0 space-y-6">
            <p className="text-[17px] leading-relaxed text-ink">{e.body}</p>

            {/* the infobox sits here on phones, beside the article on wide screens */}
            <Infobox className="lg:hidden" e={{ title: e.title, section: e.section }} rows={info} st={st} />

            {toc.length > 1 && (
              <nav aria-label="Contents" className="inline-block rounded-xl border border-line bg-[#fbfaf7] px-4 py-3 text-[14px]">
                <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Contents</p>
                <ol className="list-decimal space-y-0.5 pl-5">
                  {toc.map((t) => (
                    <li key={t.id}>
                      <a href={`#${t.id}`} className="text-[#3f2fa6] hover:underline">
                        {t.label}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            )}

            {e.diagram && (
              <section id="flow" aria-labelledby="flow-h" className="scroll-mt-24 space-y-3">
                <h2 id="flow-h" className="border-b border-line pb-1.5 text-[19px] font-semibold">
                  How it flows
                </h2>
                <Diagram id={e.diagram} accent={st.a} />
              </section>
            )}

            {(a.steps?.length || e.tool || a.curl) && (
              <section id="how" aria-labelledby="how-h" className="scroll-mt-24 space-y-3">
                <h2 id="how-h" className="border-b border-line pb-1.5 text-[19px] font-semibold">
                  How to use it
                </h2>
                {a.steps?.length ? (
                  <ol className="space-y-2.5">
                    {a.steps.map((s, i) => (
                      <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border-[1.5px] border-ink font-pixel text-[11px]" style={{ background: st.soft }}>
                          {i + 1}
                        </span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                ) : null}
                <CodeTabs
                  tabs={[
                    { label: "MCP", code: e.tool ?? "" },
                    { label: "curl", code: a.curl ?? "" },
                    { label: "HTTP", code: !a.curl && e.call ? e.call : "" },
                  ]}
                />
              </section>
            )}

            {a.seeAlso.length > 0 && (
              <section id="see" aria-labelledby="see-h" className="scroll-mt-24 space-y-3">
                <h2 id="see-h" className="border-b border-line pb-1.5 text-[19px] font-semibold">
                  See also
                </h2>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {a.seeAlso.map((s) => {
                    const x = readEntry(s.id)!;
                    return (
                      <li key={s.id}>
                        <Link href={`/town/library/${s.id}`} className="pix-lift flex items-center gap-2.5 rounded-xl border border-line bg-panel p-3">
                          <CatIcon name={x.section} size={20} />
                          <span className="min-w-0">
                            <span className="block font-medium leading-snug">{s.title}</span>
                            <span className="block text-[12px] text-ink-3">{SECTIONS[x.section]}</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <p className="border-t border-line pt-3 text-[13px] text-ink-3">
              Something missing or wrong?{" "}
              <Link href="/town/hall" className="font-medium text-ink underline underline-offset-2">
                Tell Town Hall
              </Link>
              .
            </p>
          </div>
          <Infobox className="hidden lg:block lg:sticky lg:top-20" e={{ title: e.title, section: e.section }} rows={info} st={st} />
        </article>
      </TwoForms>
    </div>
  );
}

function Infobox({ e, rows, st, className = "" }: { e: { title: string; section: string }; rows: [string, React.ReactNode][]; st: { a: string; soft: string }; className?: string }) {
  return (
    <aside className={`overflow-hidden rounded-2xl border-[1.5px] border-ink bg-panel shadow-[3px_3px_0_0_var(--color-ink)] ${className}`} aria-label="At a glance" data-testid="infobox">
      <div className="flex items-center gap-2.5 px-4 py-3" style={{ background: st.soft }}>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white">
          <CatIcon name={e.section} size={24} />
        </span>
        <p className="font-semibold leading-snug">{e.title}</p>
      </div>
      <dl className="divide-y divide-[#f1f0ec] text-[13.5px]">
        {rows
          .filter(([, v]) => v != null && v !== "" && v !== false)
          .map(([k, v]) => (
            <div key={k} className="grid grid-cols-[92px_minmax(0,1fr)] gap-2 px-4 py-2">
              <dt className="text-[12px] font-semibold text-ink-3">{k}</dt>
              <dd className="min-w-0">{v}</dd>
            </div>
          ))}
      </dl>
    </aside>
  );
}
