"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import type { StoreItem } from "@/server/town/market";
import { inputCls, usd } from "./bits";
import { CatIcon, iconStyle } from "./icons";

interface Result {
  circle: StoreItem[];
  circleError?: string;
  independent: StoreItem[];
  pending: number;
}

type Group = "all" | "circle" | "independent";
type Sort = "featured" | "low" | "high" | "name";
const PRICES = [
  ["any", "Any price", Infinity],
  ["cent", "Up to $0.01", 0.01],
  ["dime", "Up to $0.10", 0.1],
  ["dollar", "Up to $1", 1],
] as const;

/** A product card: picture, price badge, seller, network, and whether it can be paid now. */
export function ProductCard({ s }: { s: StoreItem }) {
  const st = iconStyle(s.category);
  const waiting = s.status === "pending";
  return (
    <li data-testid="store-item" data-group={s.group}>
      <Link href={`/town/store/${s.id}`} className="pix-lift group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="relative flex h-[104px] items-center justify-center" style={{ background: `linear-gradient(160deg, ${st.soft}, #ffffff)` }}>
          <span className="flex h-16 w-16 items-center justify-center rounded-xl border-[1.5px] border-ink bg-white shadow-[2px_2px_0_0_var(--color-ink)] transition-transform group-hover:-translate-y-0.5 motion-reduce:transition-none">
            <CatIcon name={s.category} size={40} />
          </span>
          <span className={`absolute left-2.5 top-2.5 inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[11.5px] font-semibold ${s.group === "circle" ? "border-[#9fd8bd] bg-[#e3f6ec] text-[#16663f]" : "border-[#bcd0ef] bg-[#e6effb] text-[#1d4fa8]"}`}>
            {s.group === "circle" ? "✓ Verified by Circle" : "Independent"}
          </span>
          <span className="num absolute right-2.5 top-2.5 rounded-md border-[1.5px] border-ink bg-warn px-1.5 py-0.5 text-[12.5px] font-bold text-ink">{usd(s.priceUsd)}</span>
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-3.5">
          <span className="line-clamp-2 break-words font-semibold leading-snug group-hover:underline group-hover:underline-offset-2">{s.name}</span>
          <span className="line-clamp-2 text-[13px] text-ink-2">{s.sells}</span>
          <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-1.5 text-[11.5px]">
            {waiting ? (
              <span className="rounded bg-warn/20 px-1.5 py-0.5 font-semibold text-warn-ink">Waiting for a check</span>
            ) : s.payableNow ? (
              <span className="rounded bg-good/10 px-1.5 py-0.5 font-semibold text-good">Payable now</span>
            ) : (
              <span className="rounded bg-[#f1f0ec] px-1.5 py-0.5 font-semibold text-ink-2">Not payable here yet</span>
            )}
            <span className="rounded bg-[#f1f0ec] px-1.5 py-0.5 text-ink-2">{s.network}</span>
          </span>
          <span className="truncate text-[12px] text-ink-3">by {s.seller}</span>
        </div>
      </Link>
    </li>
  );
}

const NETWORKS = ["Arc testnet", "Arc", "Base", "Other"];

function ListYours({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", description: "", url: "", priceUsd: "", network: "Arc testnet", seller: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string; id?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/town/store", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, priceUsd: f.priceUsd === "" ? undefined : Number(f.priceUsd) }) });
      const j = await r.json();
      if (!r.ok) return setMsg({ ok: false, text: j.error ?? "Couldn't list it" });
      setMsg({ ok: true, text: "Sent. It shows as an independent vendor, waiting for an admin's check.", id: j.id });
      setF({ name: "", description: "", url: "", priceUsd: "", network: "Arc testnet", seller: "" });
      onDone();
    } finally {
      setBusy(false);
    }
  }
  const steps = [
    ["Tell us what it sells", "Name, one line, price per request."],
    ["Give its address", "An https x402 endpoint."],
    ["An admin checks it", "Then it's listed as Independent."],
  ];
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-panel" aria-labelledby="list-yours" data-testid="store-list-yours">
      <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div>
          <h2 id="list-yours" className="font-pixel text-[15px]">
            List your service
          </h2>
          <p className="mt-1 text-[13.5px] text-ink-2">People and agents can sell here, per request. Only Circle&apos;s own marketplace earns &ldquo;Verified by Circle&rdquo;.</p>
          <ol className="mt-3 grid gap-2 sm:grid-cols-3">
            {steps.map(([t, d], i) => (
              <li key={t} className="flex items-start gap-2 rounded-lg bg-[#f6f5f1] px-2.5 py-2 text-[12.5px]">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] bg-ink font-pixel text-[10px] text-white">{i + 1}</span>
                <span>
                  <b className="block font-semibold">{t}</b>
                  <span className="text-ink-2">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <Button variant={open ? "ghost" : "primary"} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Close" : "List a service"}
        </Button>
      </div>
      {open && (
        <form onSubmit={submit} className="grid gap-3 border-t border-[#f1f0ec] px-4 py-4 sm:grid-cols-2 sm:px-5">
          <label className="text-[13px] font-medium">
            Name
            <input required maxLength={60} value={f.name} onChange={set("name")} className={`mt-1 ${inputCls}`} />
          </label>
          <label className="text-[13px] font-medium">
            Seller (you or your agent)
            <input required maxLength={60} value={f.seller} onChange={set("seller")} className={`mt-1 ${inputCls}`} />
          </label>
          <label className="text-[13px] font-medium sm:col-span-2">
            What it sells
            <textarea required minLength={10} maxLength={300} rows={2} value={f.description} onChange={set("description")} className={`mt-1 ${inputCls}`} />
          </label>
          <label className="text-[13px] font-medium sm:col-span-2">
            Its web address (https)
            <input required type="url" pattern="https://.*" maxLength={300} placeholder="https://…" value={f.url} onChange={set("url")} className={`mt-1 font-mono ${inputCls}`} />
          </label>
          <label className="text-[13px] font-medium">
            Price per request, in dollars
            <input type="number" min={0} max={1000} step="0.0001" value={f.priceUsd} onChange={set("priceUsd")} className={`mt-1 ${inputCls}`} />
          </label>
          <label className="text-[13px] font-medium">
            Network it takes payment on
            <select value={f.network} onChange={set("network")} className={`mt-1 ${inputCls}`}>
              {NETWORKS.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy && <Spinner />} Send for a check
            </Button>
            {msg && (
              <p role="status" className={`text-[13px] ${msg.ok ? "text-good" : "text-bad"}`}>
                {msg.text}{" "}
                {msg.id && (
                  <Link href={`/town/store/${msg.id}`} className="font-medium underline underline-offset-2">
                    See its page
                  </Link>
                )}
              </p>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

/** A storefront over both groups: search, filters, sorting, product cards, and listing your own service. */
export function StoreFront() {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<Group>("all");
  const [payable, setPayable] = useState(false);
  const [cat, setCat] = useState("");
  const [price, setPrice] = useState<(typeof PRICES)[number][0]>("any");
  const [sort, setSort] = useState<Sort>("featured");
  const [mine, setMine] = useState<Result | null>(null);
  const [circle, setCircle] = useState<Result | null>(null);
  const [tick, setTick] = useState(0);
  // Independent vendors answer at once; Circle's catalog is read live and may take longer.
  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/town/store?pending=1&circle=0&q=${encodeURIComponent(q)}`)
        .then((x) => x.json())
        .then(setMine)
        .catch(() => undefined);
    }, 150);
    return () => clearTimeout(t);
  }, [q, tick]);
  useEffect(() => {
    setCircle(null);
    const t = setTimeout(() => {
      fetch(`/api/town/store?limit=24&q=${encodeURIComponent(q)}`)
        .then((x) => x.json())
        .then(setCircle)
        .catch(() => setCircle({ circle: [], circleError: "Circle's marketplace didn't answer", independent: [], pending: 0 }));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const all = useMemo(() => [...(circle?.circle ?? []), ...(mine?.independent ?? [])], [circle, mine]);
  const cats = useMemo(() => [...new Set(all.map((s) => s.category))].sort(), [all]);
  const max = PRICES.find((p) => p[0] === price)![2];
  const shown = useMemo(() => {
    const list = all.filter((s) => (group === "all" || s.group === group) && (!payable || s.payableNow) && (!cat || s.category === cat) && (max === Infinity || (s.priceUsd != null && s.priceUsd <= max)));
    const byPrice = (s: StoreItem) => s.priceUsd ?? Infinity;
    if (sort === "low") return [...list].sort((a, b) => byPrice(a) - byPrice(b));
    if (sort === "high") return [...list].sort((a, b) => (b.priceUsd ?? -1) - (a.priceUsd ?? -1));
    if (sort === "name") return [...list].sort((a, b) => a.name.localeCompare(b.name));
    // Featured: what can be paid now first, then Circle's verified, then the rest as listed.
    return [...list].sort((a, b) => Number(b.payableNow) - Number(a.payableNow));
  }, [all, group, payable, cat, max, sort]);
  const count = (g: Group) => all.filter((s) => g === "all" || s.group === g).length;
  const loading = !mine || !circle;
  const sel = "h-9 rounded-lg border border-line bg-panel px-2.5 text-[13px] font-medium outline-none focus:border-ink/50";

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-2xl border border-line bg-panel p-3 sm:p-4">
        <label className="ring-agent flex h-11 items-center gap-2 rounded-xl border-[1.5px] border-ink bg-panel px-3 shadow-[2px_2px_0_0_var(--color-ink)]">
          <span className="sr-only">Search the Store</span>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-ink-2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: prices, weather, gas, wallet data…" className="w-full bg-transparent text-[15px] outline-none" data-testid="store-search" />
          {loading && <Spinner />}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Seller" className="inline-flex rounded-lg border border-line bg-[#f6f5f1] p-0.5">
            {(
              [
                ["all", "All"],
                ["circle", "Verified by Circle"],
                ["independent", "Independent"],
              ] as const
            ).map(([g, label]) => (
              <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)} className={`h-8 rounded-md px-2.5 text-[13px] font-semibold ${group === g ? "bg-ink text-white" : "text-ink-2 hover:text-ink"}`} data-testid={`store-filter-${g}`}>
                {label} <span className="num font-normal opacity-75">{count(g)}</span>
              </button>
            ))}
          </div>
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-line px-2.5 text-[13px] font-medium has-[:focus-visible]:outline-2">
            <input type="checkbox" checked={payable} onChange={(e) => setPayable(e.target.checked)} className="accent-[#0a7d0a]" data-testid="store-payable" />
            Payable now
          </label>
          <label className="sr-only" htmlFor="store-cat">
            Category
          </label>
          <select id="store-cat" value={cat} onChange={(e) => setCat(e.target.value)} className={sel}>
            <option value="">Every category</option>
            {cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="store-price">
            Price
          </label>
          <select id="store-price" value={price} onChange={(e) => setPrice(e.target.value as typeof price)} className={sel}>
            {PRICES.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <label className="ml-auto flex items-center gap-1.5 text-[13px] text-ink-2">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={sel}>
              <option value="featured">Payable first</option>
              <option value="low">Price: low to high</option>
              <option value="high">Price: high to low</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px] text-ink-3" aria-live="polite">
        <span>
          {shown.length} {shown.length === 1 ? "service" : "services"}
          {q ? ` for “${q}”` : ""}
          {!circle ? " · reading Circle's marketplace…" : ""}
        </span>
        {circle?.circleError && <span className="text-warn-ink">{circle.circleError}. Independent vendors are still here.</span>}
        {mine && mine.pending > 0 && <span>{mine.pending} waiting for an admin&apos;s check</span>}
      </div>

      {shown.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="store-grid">
          {shown.map((s) => (
            <ProductCard key={s.id} s={s} />
          ))}
        </ul>
      ) : (
        !loading && (
          <p className="rounded-2xl border border-dashed border-[#d5d4ce] p-8 text-center text-sm text-ink-2">
            Nothing here matches.{" "}
            <Link href="/town/hall" className="font-medium text-ink underline underline-offset-2">
              Ask for it at Town Hall
            </Link>
            , or list your own below.
          </p>
        )
      )}

      <ListYours onDone={() => setTick((t) => t + 1)} />
    </div>
  );
}
