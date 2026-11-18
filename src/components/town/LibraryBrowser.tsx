"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { LibraryEntry, Section } from "@/server/town/library";
import { Spinner } from "@/components/ui";
import { day } from "./bits";

/** Search the Library; results grouped by section, each a link to the full entry. */
export function LibraryBrowser({ initial, sections }: { initial: LibraryEntry[]; sections: Record<Section, string> }) {
  const [q, setQ] = useState("");
  const [section, setSection] = useState<Section | "">("");
  const [entries, setEntries] = useState(initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q && !section) return setEntries(initial);
    setBusy(true);
    const t = setTimeout(() => {
      fetch(`/api/town/library?q=${encodeURIComponent(q)}&section=${section}`)
        .then((r) => r.json())
        .then((j) => setEntries(j.entries))
        .catch(() => undefined)
        .finally(() => setBusy(false));
    }, 180);
    return () => clearTimeout(t);
  }, [q, section, initial]);

  const groups = useMemo(() => {
    const out = new Map<Section, LibraryEntry[]>();
    for (const e of entries) out.set(e.section, [...(out.get(e.section) ?? []), e]);
    // Best matches lead when searching; otherwise the sections keep their order.
    return q ? [...out.entries()] : (Object.keys(sections) as Section[]).filter((s) => out.has(s)).map((s) => [s, out.get(s)!] as const);
  }, [entries, q, sections]);

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <label className="ring-agent flex h-11 items-center gap-2 rounded-lg border border-line bg-panel px-3">
          <span className="sr-only">Search the Library</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-ink-3" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: pay per request, read a price, refunds, limits…" className="w-full bg-transparent text-[15px] outline-none" data-testid="library-search" />
          {busy && <Spinner />}
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sections">
          {([["", "Everything"], ...Object.entries(sections)] as [Section | "", string][]).map(([id, label]) => (
            <button
              key={id || "all"}
              type="button"
              aria-pressed={section === id}
              onClick={() => setSection(id)}
              className={`pressable h-8 rounded-md border px-2.5 text-[13px] font-medium ${section === id ? "border-ink bg-ink text-white" : "border-line bg-panel text-ink-2 hover:border-[#c9c8c2] hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[13px] text-ink-3" aria-live="polite">
        {entries.length} {entries.length === 1 ? "entry" : "entries"}
        {q ? ` for “${q}”` : ""}
      </p>

      {groups.map(([s, list]) => (
        <section key={s} aria-labelledby={`sec-${s}`}>
          <h2 id={`sec-${s}`} className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-3">
            {sections[s]}
          </h2>
          <ul className="grid gap-2.5 md:grid-cols-2" data-testid="library-results">
            {list.map((e) => (
              <li key={e.id}>
                <Link href={`/town/library/${e.id}`} className="pix-lift block h-full rounded-xl border border-line bg-panel p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-semibold leading-snug">{e.title}</span>
                    {e.price && <span className="num shrink-0 rounded-md bg-[#f1f0ec] px-1.5 py-0.5 text-[11.5px] font-semibold text-ink-2">{e.price.split(" · ")[0]}</span>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13.5px] text-ink-2">{e.body}</p>
                  <p className="mt-2 text-[12px] text-ink-3">
                    Updated {day(e.updated)}
                    {e.credit ? " · from a Town Hall request" : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {entries.length === 0 && <p className="rounded-2xl border border-dashed border-[#d5d4ce] p-8 text-center text-sm text-ink-2">Nothing in the Library matches that. You can ask for it at Town Hall.</p>}
    </div>
  );
}
