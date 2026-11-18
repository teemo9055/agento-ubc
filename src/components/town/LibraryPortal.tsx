"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { LibraryEntry } from "@/server/town/library";
import { SECTION_BLURB, SECTIONS, type Section } from "@/server/town/sections";
import { CatIcon, iconStyle } from "./icons";
import { day } from "./bits";

/** Words in any order; title matches first. The same rule as the Library's search API. */
function search(entries: LibraryEntry[], q: string) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return entries
    .map((e) => {
      const title = e.title.toLowerCase();
      const rest = [e.body, e.call, e.tool, e.price, e.source, e.kind, SECTIONS[e.section]].join(" ").toLowerCase();
      let s = 0;
      for (const w of words) {
        if (title.includes(w)) s += 3;
        else if (rest.includes(w)) s += 1;
        else return [e, 0] as const;
      }
      return [e, s] as const;
    })
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([e]) => e);
}

const firstPrice = (p?: string) => p?.split(" · ")[0];

function Row({ e }: { e: LibraryEntry }) {
  return (
    <li>
      <Link href={`/town/library/${e.id}`} className="group flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-[#f6f5f1]">
        <CatIcon name={e.section} size={20} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold group-hover:underline group-hover:underline-offset-2">{e.title}</span>
            <span className="text-[12px] text-ink-3">{SECTIONS[e.section]}</span>
          </span>
          <span className="mt-0.5 line-clamp-2 block text-[13.5px] text-ink-2">{e.body}</span>
        </span>
        {e.price && <span className="num mt-0.5 hidden shrink-0 rounded-md bg-[#f1f0ec] px-1.5 py-0.5 text-[11.5px] font-semibold text-ink-2 sm:inline">{firstPrice(e.price)}</span>}
      </Link>
    </li>
  );
}

/** The Library's front page, like a wiki portal: search as you type, start-here articles, categories, recent changes, and every article by category. */
export function LibraryPortal({ entries, featured }: { entries: LibraryEntry[]; featured: string[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Section | null>(null);
  // A category can be opened by address: /town/library#limits
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (h in SECTIONS) setCat(h as Section);
  }, []);
  const hits = useMemo(() => (q.trim() ? search(entries, q) : []), [entries, q]);
  const sections = (Object.keys(SECTIONS) as Section[]).filter((s) => entries.some((e) => e.section === s));
  const byId = new Map(entries.map((e) => [e.id, e]));
  const start = featured.map((id) => byId.get(id)).filter((e): e is LibraryEntry => Boolean(e));
  const recent = [...entries].sort((a, b) => b.updated.localeCompare(a.updated) || Number(b.section === "updates") - Number(a.section === "updates")).slice(0, 6);
  const newest = recent[0]?.updated;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="ring-agent flex h-12 items-center gap-2.5 rounded-xl border-[1.5px] border-ink bg-panel px-3.5 shadow-[3px_3px_0_0_var(--color-ink)]">
          <span className="sr-only">Search the Library</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-ink-2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: pay per request, refunds, vault, x402…" className="w-full bg-transparent text-[15.5px] outline-none" data-testid="library-search" type="search" />
        </label>
        <p className="text-[13px] text-ink-3" aria-live="polite">
          {q.trim() ? `${hits.length} ${hits.length === 1 ? "article" : "articles"} for “${q.trim()}”` : `${entries.length} articles · updated ${newest ? day(newest) : "—"}`}
        </p>
      </div>

      {q.trim() ? (
        <section aria-label="Search results" className="rounded-2xl border border-line bg-panel p-2" data-testid="library-results">
          {hits.length ? (
            <ul className="divide-y divide-[#f4f3ef]">
              {hits.map((e) => (
                <Row key={e.id} e={e} />
              ))}
            </ul>
          ) : (
            <p className="p-6 text-center text-[14px] text-ink-2">
              Nothing matches that.{" "}
              <Link href="/town/hall" className="font-medium text-ink underline underline-offset-2">
                Ask for it at Town Hall
              </Link>
              .
            </p>
          )}
        </section>
      ) : (
        <>
          <section aria-labelledby="start">
            <h2 id="start" className="mb-2.5 font-pixel text-[15px]">
              Start here
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {start.map((e, i) => (
                <li key={e.id} className={i === 0 ? "sm:col-span-2 lg:col-span-1" : ""}>
                  <Link href={`/town/library/${e.id}`} className="pix-lift flex h-full flex-col rounded-xl border border-line bg-panel p-3.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: iconStyle(e.section).soft }}>
                      <CatIcon name={e.section} size={22} />
                    </span>
                    <span className="mt-2 font-semibold leading-snug">{e.title}</span>
                    <span className="mt-1 line-clamp-3 text-[13px] text-ink-2">{e.body}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="cats">
            <h2 id="cats" className="mb-2.5 font-pixel text-[15px]">
              Browse by category
            </h2>
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="library-categories">
              {sections.map((s) => {
                const n = entries.filter((e) => e.section === s).length;
                const st = iconStyle(s);
                return (
                  <li key={s}>
                    <button
                      type="button"
                      aria-pressed={cat === s}
                      onClick={() => setCat(cat === s ? null : s)}
                      className={`pressable flex h-full w-full items-start gap-3 rounded-xl border p-3 text-left ${cat === s ? "border-ink shadow-[2px_2px_0_0_var(--color-ink)]" : "border-line hover:border-[#c9c8c2]"}`}
                      style={{ background: cat === s ? st.soft : "var(--color-panel)" }}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: st.soft }}>
                        <CatIcon name={s} size={24} />
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-baseline gap-1.5">
                          <span className="font-semibold leading-tight">{SECTIONS[s]}</span>
                          <span className="num text-[12px] text-ink-3">{n}</span>
                        </span>
                        <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-2">{SECTION_BLURB[s]}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section aria-labelledby="all" className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="all" className="font-pixel text-[15px]">
                  {cat ? SECTIONS[cat] : "Every article"}
                </h2>
                {cat && (
                  <button type="button" onClick={() => setCat(null)} className="text-[13px] font-medium text-ink-2 underline underline-offset-2 hover:text-ink">
                    Show every category
                  </button>
                )}
              </div>
              {cat ? (
                <ul className="-mx-3 divide-y divide-[#f4f3ef]" data-testid="library-category-list">
                  {entries
                    .filter((e) => e.section === cat)
                    .map((e) => (
                      <Row key={e.id} e={e} />
                    ))}
                </ul>
              ) : (
                <div className="columns-1 gap-6 sm:columns-2">
                  {sections.map((s) => (
                    <div key={s} className="mb-4 break-inside-avoid">
                      <h3 className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
                        <CatIcon name={s} size={14} /> {SECTIONS[s]}
                      </h3>
                      <ul className="space-y-0.5 text-[14px]">
                        {entries
                          .filter((e) => e.section === s)
                          .map((e) => (
                            <li key={e.id}>
                              <Link href={`/town/library/${e.id}`} className="text-[#3f2fa6] hover:underline hover:underline-offset-2">
                                {e.title}
                              </Link>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <aside aria-labelledby="recent" className="rounded-2xl border border-line bg-panel p-4">
              <h2 id="recent" className="mb-2 font-pixel text-[15px]">
                Recently updated
              </h2>
              <ol className="space-y-2.5">
                {recent.map((e) => (
                  <li key={e.id} className="text-[13.5px] leading-snug">
                    <Link href={`/town/library/${e.id}`} className="font-medium hover:underline hover:underline-offset-2">
                      {e.title}
                    </Link>
                    <span className="block text-[12px] text-ink-3">
                      {day(e.updated)} · {SECTIONS[e.section]}
                    </span>
                  </li>
                ))}
              </ol>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
