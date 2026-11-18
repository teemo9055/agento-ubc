"use client";
import { useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import type { StoreItem } from "@/server/town/market";
import { inputCls, usd } from "./bits";

interface Result {
  circle: StoreItem[];
  circleError?: string;
  independent: StoreItem[];
  pending: number;
}

function Row({ s }: { s: StoreItem }) {
  const waiting = s.status === "pending";
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2.5" data-testid="store-item">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold">{s.name}</span>
          <span className="text-[12.5px] text-ink-3">by {s.seller}</span>
          {waiting && <span className="rounded bg-warn/20 px-1.5 py-0.5 text-[11px] font-semibold text-warn-ink">Waiting for a check</span>}
        </div>
        <p className="mt-0.5 text-[13.5px] text-ink-2">{s.sells}</p>
        {!waiting && (
          <p className="mt-0.5 truncate font-mono text-[11.5px] text-ink-3" title={s.url}>
            {s.url}
          </p>
        )}
      </div>
      <div className="num shrink-0 text-right text-[13px]">
        <div className="font-semibold">{usd(s.priceUsd)}</div>
        <div className="text-[12px] text-ink-3">{s.network}</div>
        <div className={`text-[12px] font-semibold ${s.payableNow ? "text-good" : "text-ink-3"}`}>{s.payableNow ? "Payable now" : "Not payable here yet"}</div>
      </div>
    </li>
  );
}

const NETWORKS = ["Arc testnet", "Arc", "Base", "Other"];

function ListYours({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", description: "", url: "", priceUsd: "", network: "Arc testnet", seller: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
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
      setMsg({ ok: true, text: "Listed. It shows as an independent vendor, waiting for a check by an admin." });
      setF({ name: "", description: "", url: "", priceUsd: "", network: "Arc testnet", seller: "" });
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-2xl border border-line bg-panel" aria-labelledby="list-yours">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <div>
          <h2 id="list-yours" className="text-[16px] font-semibold">
            Sell something here
          </h2>
          <p className="mt-0.5 text-[13.5px] text-ink-2">People and agents can list a paid service. It starts as an independent vendor until an admin checks it.</p>
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
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy && <Spinner />} Send for a check
            </Button>
            {msg && (
              <p role="status" className={`text-[13px] ${msg.ok ? "text-good" : "text-bad"}`}>
                {msg.text}
              </p>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

/** Both groups of the Store with one search over them, and a way to list your own service. */
export function StoreFront() {
  const [q, setQ] = useState("");
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
    }, 200);
    return () => clearTimeout(t);
  }, [q, tick]);
  useEffect(() => {
    setCircle(null);
    const t = setTimeout(() => {
      fetch(`/api/town/store?q=${encodeURIComponent(q)}`)
        .then((x) => x.json())
        .then(setCircle)
        .catch(() => setCircle({ circle: [], circleError: "Circle's marketplace didn't answer", independent: [], pending: 0 }));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const busy = !mine || !circle;
  const r = mine && { ...mine, circle: circle?.circle ?? [], circleError: circle?.circleError };

  return (
    <div className="space-y-5">
      <label className="ring-agent flex h-11 items-center gap-2 rounded-lg border border-line bg-panel px-3">
        <span className="sr-only">Search the Store</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-ink-3" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: prices, weather, web search, wallet data…" className="w-full bg-transparent text-[15px] outline-none" data-testid="store-search" />
        {busy && <Spinner />}
      </label>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-panel" aria-labelledby="verified" data-testid="store-circle">
          <div className="border-b border-[#f1f0ec] px-4 py-3 sm:px-5">
            <h2 id="verified" className="flex items-center gap-2 text-[16px] font-semibold">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-[4px] border-[1.5px] border-ink bg-[#e3f6ec] text-[11px] font-bold" aria-hidden>
                ✓
              </span>
              Verified by Circle
            </h2>
            <p className="mt-0.5 text-[13.5px] text-ink-2">Listed on Circle&apos;s Agent Marketplace.</p>
          </div>
          <div className="px-4 sm:px-5">
            {r?.circleError && <p className="py-3 text-[13px] text-warn-ink">{r.circleError}. Try again in a moment.</p>}
            {!circle && (
              <p className="flex items-center gap-2 py-3 text-[13px] text-ink-3">
                <Spinner /> Reading Circle&apos;s marketplace…
              </p>
            )}
            {circle && r && !r.circleError && r.circle.length === 0 && <p className="py-3 text-[13px] text-ink-3">Nothing listed for that.</p>}
            <ul className="divide-y divide-[#f1f0ec]">{r?.circle.map((s) => <Row key={s.id} s={s} />)}</ul>
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-panel" aria-labelledby="independent" data-testid="store-independent">
          <div className="border-b border-[#f1f0ec] px-4 py-3 sm:px-5">
            <h2 id="independent" className="flex items-center gap-2 text-[16px] font-semibold">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-[4px] border-[1.5px] border-ink bg-[#e6effb] font-pixel text-[11px]" aria-hidden>
                i
              </span>
              Independent vendors
            </h2>
            <p className="mt-0.5 text-[13.5px] text-ink-2">Agento&apos;s own answers, and vendors listed here by people and agents.</p>
          </div>
          <div className="px-4 sm:px-5">
            {r && r.independent.length === 0 && <p className="py-3 text-[13px] text-ink-3">Nothing listed for that.</p>}
            <ul className="divide-y divide-[#f1f0ec]">{r?.independent.map((s) => <Row key={s.id} s={s} />)}</ul>
          </div>
        </section>
      </div>

      <ListYours onDone={() => setTick((t) => t + 1)} />
    </div>
  );
}
