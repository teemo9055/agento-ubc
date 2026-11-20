"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "./Icon";
import { Spinner } from "./ui";
import { Glyph } from "./Glyph";
import type { JobCardInfo, JobChoice, JobPreview, JobSection } from "@/lib/jobs";
import { JOBS, SECTIONS } from "@/lib/jobs";
import type { AgentId } from "@/lib/types";

type Catalog = { venue: string; sections: typeof SECTIONS; jobs: JobCardInfo[]; previews: JobPreview[] };

const money = (x?: number) => (x == null ? "–" : x > 0 && x < 0.01 ? `$${x.toFixed(4).replace(/0+$/, "")}` : `$${x.toFixed(2)}`);
const pct = (p?: number) => (p == null ? "–" : p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`);
function closesIn(iso?: string) {
  if (!iso) return undefined;
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "closing";
  const h = ms / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min left` : h < 48 ? `${Math.round(h)} h left` : `${Math.round(h / 24)} days left`;
}

/** Live catalog for one agent, refreshed every 45 seconds. */
export function useCatalog(agent: AgentId, venue?: string) {
  const [data, setData] = useState<Catalog | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(`/api/jobs?agent=${agent}${venue ? `&venue=${venue}` : ""}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d: Catalog) => live && (setData(d), setFailed(false)))
        .catch(() => live && setFailed(true));
    void load();
    const t = setInterval(load, 45_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [agent, venue]);
  return { data, failed };
}

/** One section: a title, its one-line promise, and a row of cards that scrolls sideways. */
export function JobRow({ section, jobs, previews, onStart, busy, loading }: { section: JobSection; jobs: JobCardInfo[]; previews: Map<string, JobPreview>; onStart: (id: string, choice?: string, inputs?: Record<string, string>) => void; busy: string; loading: boolean }) {
  const row = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: true });
  const s = SECTIONS[section];
  const update = () => {
    const el = row.current;
    if (!el) return;
    setEdge({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(update, [jobs.length]);
  const by = (d: number) => row.current?.scrollBy({ left: d * Math.min(640, (row.current?.clientWidth ?? 600) * 0.85), behavior: "smooth" });
  return (
    <section aria-labelledby={`sec-${section}`} className="min-w-0" data-testid={`section-${section}`}>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 id={`sec-${section}`} className="font-pixel text-[20px] leading-tight sm:text-[22px]">
            {s.title}
          </h2>
          <p className="mt-0.5 text-[13.5px] text-ink-2">{s.blurb}</p>
        </div>
        <div className="hidden shrink-0 gap-1.5 sm:flex">
          {([-1, 1] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => by(d)}
              disabled={d < 0 ? !edge.left : !edge.right}
              aria-label={d < 0 ? `Earlier ${s.title.toLowerCase()} jobs` : `More ${s.title.toLowerCase()} jobs`}
              className="pressable inline-flex h-9 w-9 items-center justify-center rounded-full border-[1.5px] border-ink bg-panel transition-opacity hover:bg-ink hover:text-white disabled:pointer-events-none disabled:opacity-25"
            >
              <Icon name={d < 0 ? "back" : "arrow"} size={15} />
            </button>
          ))}
        </div>
      </div>
      <div className="relative -mx-4 sm:-mx-1">
        <div ref={row} onScroll={update} className="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-4 pb-4 pt-1 sm:px-1">
          {jobs.map((j, i) => (
            <JobTile key={j.id} job={j} p={previews.get(j.id)} i={i} onStart={onStart} busy={busy === j.id} disabled={Boolean(busy)} loading={loading} />
          ))}
        </div>
        <AnimatePresence>{edge.right && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-surface to-transparent" aria-hidden />}</AnimatePresence>
      </div>
    </section>
  );
}

/**
 * A job as a card, the way a market is on a prediction exchange: what it's about, the live number
 * that matters (the market's odds, or what the checks cost), and one button to start.
 */
function JobTile({ job, p, i, onStart, busy, disabled, loading }: { job: JobCardInfo; p?: JobPreview; i: number; onStart: (id: string, choice?: string, inputs?: Record<string, string>) => void; busy: boolean; disabled: boolean; loading: boolean }) {
  const off = Boolean(p?.unavailable);
  // What the person picked on the card (their city, team or price line); the card's numbers follow it.
  const [picked, setPicked] = useState<string>();
  // The person's own link, business, phone or place: the job is built from these.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const choice = p?.choices?.find((c) => c.id === picked) ?? p?.choices?.find((c) => c.id === p?.choice);
  const shown = p && choice ? { ...p, market: choice.market, line: choice.line, chance: choice.chance, pay: choice.pay, get: choice.get, closes: choice.closes } : p;
  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(i, 6) * 0.05, type: "spring", stiffness: 260, damping: 26 }}
      whileHover={off ? undefined : { y: -4 }}
      className={`group relative flex w-[78vw] max-w-[300px] shrink-0 snap-start flex-col rounded-[22px] border-[1.5px] border-ink bg-panel p-4 transition-shadow duration-200 sm:w-[296px] ${off ? "opacity-60" : "hover:shadow-[6px_6px_0_0_var(--agent)]"}`}
      data-testid="job-card"
      data-job={job.id}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex shrink-0 rounded-[14px] border-[1.5px] border-ink bg-agent-soft p-2 shadow-[2px_2px_0_0_var(--color-ink)] transition-transform duration-200 group-hover:-rotate-3">
          <Glyph name={job.glyph} size={30} />
        </span>
      </div>
      <h3 className="mt-3 text-[16px] font-semibold leading-snug">{job.title}</h3>

      <div className="mt-auto pt-4">
        {job.inputs && !off && (
          <div className="mb-2.5 grid gap-2" data-testid="job-inputs">
            {job.inputs.map((f) => (
              <label key={f.name} className="flex flex-col gap-1 rounded-xl border-[1.5px] border-ink bg-panel px-3 py-2 transition-shadow focus-within:shadow-[3px_3px_0_0_var(--agent)]">
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-agent-ink">{f.label}</span>
                <input
                  value={typed[f.name] ?? ""}
                  onChange={(e) => setTyped((t) => ({ ...t, [f.name]: e.target.value }))}
                  placeholder={f.example}
                  disabled={disabled}
                  inputMode={f.type === "phone" ? "tel" : f.type === "listing_url" ? "url" : "text"}
                  className="min-w-0 bg-transparent text-[13.5px] font-medium outline-none placeholder:text-ink-3 focus-visible:outline-none"
                  data-testid="job-input"
                  data-input={f.name}
                />
              </label>
            ))}
            <span className="text-[11.5px] text-ink-3">Leave blank to try the example.</span>
          </div>
        )}
        {p?.choices && p.choices.length > 1 && !off && <Picker label={p.pick ?? "Pick"} choices={p.choices} value={choice?.id} onChange={setPicked} disabled={disabled} />}
        {job.agent === "inso" ? <Odds p={shown} loading={loading} /> : <Cost job={job} p={p} loading={loading} />}
        <button
          type="button"
          onClick={() => onStart(job.id, choice?.id, Object.fromEntries(Object.entries(typed).filter(([, v]) => v.trim())))}
          disabled={disabled || off || (loading && !p)}
          className="pressable mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border-[1.5px] border-ink bg-ink text-[14px] font-semibold text-white transition-colors hover:bg-agent hover:text-agent-on disabled:cursor-not-allowed disabled:opacity-50"
          title={p?.unavailable}
          data-testid="job-start"
        >
          {busy ? (
            <>
              <Spinner /> Setting it up
            </>
          ) : off ? (
            p?.needsMainnet ? "Needs Arc mainnet" : p?.needsVerified ? "Needs a verified Gemini account" : p?.needsVenue ? "Needs Gemini's real exchange" : "Not open right now"
          ) : (
            <>
              Start <Icon name="arrow" size={15} className="transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </div>
    </motion.article>
  );
}

/**
 * What the cover is about, picked on the card: a button that reads like a field ("City · Chicago"),
 * opening a list over the card's lower half with each option's odds. Long lists get a filter box.
 */
function Picker({ label, choices, value, onChange, disabled }: { label: string; choices: JobChoice[]; value?: string; onChange: (id: string) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const current = choices.find((c) => c.id === value) ?? choices[0];
  const shown = q ? choices.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())) : choices;
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQ("");
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return setOpen(false);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      setAt((i) => Math.max(0, Math.min(shown.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))));
    }
    if (e.key === "Enter" && open && shown[at]) {
      e.preventDefault();
      pick(shown[at].id);
    }
  };
  return (
    <div ref={box} className="mb-2.5" onKeyDown={keys}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((o) => !o);
          setAt(Math.max(0, choices.indexOf(current)));
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label}`}
        className={`pressable flex h-11 w-full items-center gap-2.5 rounded-xl border-[1.5px] border-ink bg-panel px-3 text-left transition-shadow ${open ? "shadow-[3px_3px_0_0_var(--agent)]" : "hover:shadow-[3px_3px_0_0_var(--agent)]"}`}
        data-testid="job-pick"
      >
        <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-wide text-agent-ink">{label}</span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{current?.label}</span>
        <Icon name="chevron" size={14} className={`shrink-0 transition-transform ${open ? "-rotate-90" : "rotate-90"}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14 }}
            className="absolute inset-x-4 bottom-4 z-20 flex flex-col overflow-hidden rounded-2xl border-[1.5px] border-ink bg-panel shadow-[4px_4px_0_0_var(--color-ink)]"
            style={{ top: (box.current?.offsetTop ?? 0) + 50 }}
          >
            {choices.length > 7 && (
              <label className="flex items-center gap-2 border-b border-line px-3 py-2 focus-within:bg-agent-soft/40">
                <Icon name="search" size={14} className="text-ink-3" />
                <span className="sr-only">Filter {label.toLowerCase()}</span>
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setAt(0);
                  }}
                  placeholder={`Search ${choices.length} ${label === "City" ? "cities" : "options"}`}
                  className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none focus-visible:outline-none"
                />
              </label>
            )}
            <ul role="listbox" aria-label={label} className="overflow-y-auto overscroll-contain p-1.5">
              {shown.map((c, i) => {
                const on = c.id === current?.id;
                return (
                  <li key={c.id} role="option" aria-selected={on}>
                    <button
                      type="button"
                      onClick={() => pick(c.id)}
                      onMouseEnter={() => setAt(i)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13.5px] ${i === at ? "bg-agent-soft" : ""} ${on ? "font-semibold text-agent-ink" : "text-ink"}`}
                      data-testid="job-pick-option"
                    >
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      {c.line && c.line !== c.label && <span className="hidden truncate text-[11.5px] text-ink-3 min-[380px]:block">{c.line}</span>}
                      <span className="num w-10 shrink-0 text-right text-[12.5px] font-semibold text-agent-ink">{pct(c.chance)}</span>
                      {on ? <Icon name="check" size={13} stroke={2.4} className="shrink-0" /> : <span className="w-[13px] shrink-0" />}
                    </button>
                  </li>
                );
              })}
              {!shown.length && <li className="px-2.5 py-3 text-[13px] text-ink-3">Nothing matches “{q}”.</li>}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Inso: the market behind the cover, its odds as a bar, and what the cover costs and pays. */
function Odds({ p, loading }: { p?: JobPreview; loading: boolean }) {
  if (!p) return <Shimmer lines={3} on={loading} />;
  if (p.unavailable) return null;
  return (
    <div className="rounded-2xl bg-[#f6f5f1] p-3" data-testid="job-odds">
      <div className="truncate text-[11.5px] text-ink-3" title={p.market}>
        {p.market}
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <span className="min-w-0 truncate text-[14px] font-semibold">{p.line}</span>
        <span className="num shrink-0 text-[24px] font-semibold leading-none text-agent-ink">{pct(p.chance)}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e4e2dc]">
        <motion.div className="h-full rounded-full bg-agent" initial={{ width: 0 }} animate={{ width: `${Math.max(3, (p.chance ?? 0) * 100)}%` }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[12.5px]">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="num rounded-md bg-panel px-1.5 py-0.5 font-semibold">Pay {money(p.pay)}</span>
          <Icon name="arrow" size={12} className="text-ink-3" />
          <span className="num rounded-md bg-good/10 px-1.5 py-0.5 font-semibold text-good">Get {money(p.get)}</span>
        </span>
        <span className="num whitespace-nowrap text-[12px] text-ink-3">{closesIn(p.closes)}</span>
      </div>
      {p.cost != null && (
        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-dashed border-line pt-2 text-[12px] text-ink-2" data-testid="job-news-cost">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="search" size={12} /> {p.steps ?? 1} check{(p.steps ?? 1) === 1 ? "" : "s"} first, from other sellers
          </span>
          <span className="num font-semibold">{money(p.cost)}</span>
        </div>
      )}
    </div>
  );
}

/** Worko: how many paid steps and the most they cost. */
function Cost({ job, p, loading }: { job: JobCardInfo; p?: JobPreview; loading: boolean }) {
  if (!p) return <Shimmer lines={2} on={loading} />;
  if (p.unavailable) return null;
  return (
    <div className="flex items-center justify-between rounded-2xl bg-[#f6f5f1] px-3 py-2.5" data-testid="job-cost">
      <span className="text-[12.5px] text-ink-2">
        {p.steps ?? 1} paid step{(p.steps ?? 1) === 1 ? "" : "s"}
        {job.money === "real" ? " · Arc mainnet" : " · Arc testnet"}
      </span>
      <span className="num text-[18px] font-semibold text-agent-ink">{money(p.cost)}</span>
    </div>
  );
}

function Shimmer({ lines, on }: { lines: number; on: boolean }) {
  return (
    <div className={`space-y-2 rounded-2xl bg-[#f6f5f1] p-3 ${on ? "animate-pulse motion-reduce:animate-none" : ""}`} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-3 rounded bg-[#e6e4de]" style={{ width: `${90 - i * 18}%` }} />
      ))}
    </div>
  );
}

/** Every section of one agent, in order, from the live catalog. */
export function Catalog({ agent, venue, onStart, busy }: { agent: AgentId; venue?: string; onStart: (id: string, choice?: string, inputs?: Record<string, string>) => void; busy: string }) {
  const { data, failed } = useCatalog(agent, venue);
  const previews = useMemo(() => new Map((data?.previews ?? []).map((p) => [p.id, p])), [data]);
  const jobs = data?.jobs ?? JOBS.filter((j) => j.agent === agent);
  const sections = (Object.keys(SECTIONS) as JobSection[]).filter((s) => SECTIONS[s].agent === agent);
  return (
    <div className="flex flex-col gap-9">
      {failed && !data && <p className="rounded-2xl border border-warn bg-warn/10 p-3 text-[13px] text-warn-ink">Live prices didn&apos;t load. The jobs still open; numbers fill in when the connection comes back.</p>}
      {sections.map((s) => (
        <JobRow key={s} section={s} jobs={jobs.filter((j) => j.section === s)} previews={previews} onStart={onStart} busy={busy} loading={!data} />
      ))}
    </div>
  );
}
