"use client";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { Spinner } from "./ui";

interface Stats {
  total: number;
  payableNow: number;
  onArcMainnet: number;
  network: string;
  vendors: { provider: string; endpoints: number; from: number | null; example: string }[];
}
interface Item {
  name: string;
  provider: string;
  what: string;
  priceUsd: number | null;
  payableHere: boolean;
  networks: string[];
}

const price = (x: number | null) => (x == null ? "—" : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`);

/** What the agents can buy: the vendors payable right now, and a search over the whole marketplace. */
export function Marketplace() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/marketplace")
      .then((r) => r.json())
      .then((j) => (j.error ? setErr(j.error) : setStats(j.stats)))
      .catch(() => setErr("Couldn't reach the marketplace"));
  }, []);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return setItems(null);
    setBusy(true);
    try {
      const j = await fetch(`/api/marketplace?q=${encodeURIComponent(q)}`).then((r) => r.json());
      setItems(j.items ?? []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-panel" aria-labelledby="mk-title" data-testid="marketplace">
      <div className="border-b border-[#f1f0ec] px-4 py-3.5 sm:px-5">
        <h2 id="mk-title" className="text-[16px] font-semibold">
          What agents can buy
        </h2>
        <p className="mt-0.5 text-[13.5px] text-ink-2">
          Agents pay other services per request in USDC, through Circle&apos;s Agent Marketplace. You approve each purchase with its price before anything is paid.
        </p>
        {stats && (
          <p className="num mt-2 text-[13px] text-ink-2" data-testid="mk-stats">
            <b className="font-semibold text-ink">{stats.payableNow}</b> services payable now on {stats.network} · <b className="font-semibold text-ink">{stats.onArcMainnet.toLocaleString()}</b> more open up on Arc mainnet ·{" "}
            {stats.total.toLocaleString()} listed in all
          </p>
        )}
        {err && <p className="mt-2 text-[13px] text-warn-ink">{err}</p>}
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
        <div className="rounded-xl border border-line p-3.5">
          <div className="text-[13px] font-semibold">Agento data feed</div>
          <p className="mt-0.5 text-[12.5px] text-ink-2">Gemini odds history, trade flow, price candles and driving routes, sold per request from your job&apos;s vault.</p>
          <p className="num mt-2 text-[12px] text-ink-3">from $0.02 · payable now</p>
        </div>
        {(stats?.vendors ?? []).map((v) => (
          <div key={v.provider} className="rounded-xl border border-line p-3.5" data-testid="mk-vendor">
            <div className="text-[13px] font-semibold">{v.provider}</div>
            <p className="mt-0.5 text-[12.5px] text-ink-2">
              {v.provider === "Quicknode"
                ? "Pay-per-call access to blockchains: Chainlink prices (coins, gold, FX), gas, Bitcoin fees, wallet balances, or any other read."
                : v.provider === "BotPay"
                  ? "Paid access receipts and verification codes."
                  : v.example}
            </p>
            <p className="num mt-2 text-[12px] text-ink-3">
              {v.endpoints} {v.endpoints === 1 ? "endpoint" : "endpoints"} · from {price(v.from)} · payable now
            </p>
          </div>
        ))}
        {!stats && !err && (
          <div className="flex items-center gap-2 p-3.5 text-[13px] text-ink-3">
            <Spinner /> Reading the marketplace…
          </div>
        )}
      </div>

      <form onSubmit={search} className="border-t border-[#f1f0ec] px-4 py-3.5 sm:px-5">
        <label className="flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3">
          <Icon name="search" size={15} className="text-ink-3" />
          <span className="sr-only">Search the marketplace</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everything listed: flights, web search, wallet data…" className="w-full bg-transparent text-sm outline-none" data-testid="mk-search" />
          {busy && <Spinner />}
        </label>
        {items && (
          <ul className="mt-3 divide-y divide-[#f1f0ec]" data-testid="mk-results">
            {items.length === 0 && <li className="py-2 text-[13px] text-ink-3">Nothing listed for that.</li>}
            {items.map((s, i) => (
              <li key={`${s.name}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2 text-[13px]">
                <span className="min-w-0 flex-1">
                  <b className="font-semibold">{s.provider}</b> <span className="text-ink-2">{s.what || s.name}</span>
                </span>
                <span className="num shrink-0 text-[12.5px]">
                  {price(s.priceUsd)} ·{" "}
                  {s.payableHere ? <span className="font-semibold text-good">payable now</span> : <span className="text-ink-3">needs {s.networks.includes("Arc") ? "Arc mainnet" : (s.networks[0] ?? "another network")}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </form>
    </section>
  );
}
