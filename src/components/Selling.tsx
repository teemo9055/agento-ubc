"use client";
import { useEffect, useState } from "react";
import { txUrl } from "@/lib/format";
import { Icon } from "./Icon";

interface Catalog {
  network: string;
  payTo: string;
  openapi: string;
  resources: { resource: string; description: string; priceUsd: number; example: string }[];
  sales: {
    outside: { count: number; total: string; buyers: number };
    own: { count: number; total: string };
    recent: { id: string; product: string; payer: string; amount: string; tx: string; own: boolean; at: string }[];
  };
}

const usd = (base: string | number) => {
  const x = typeof base === "number" ? base : Number(base) / 1e6;
  return x === 0 ? "$0" : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`;
};
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * The other side of the marketplace: what this app sells to other agents per request, and what
 * it has earned. The same endpoints its own jobs pay for are open to anyone with USDC on Arc.
 */
export function Selling() {
  const [c, setC] = useState<Catalog | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const load = () =>
      fetch("/api/x402")
        .then((r) => r.json())
        .then(setC)
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);
  if (!c) return null;
  const s = c.sales;
  return (
    <section className="rounded-2xl border border-line bg-panel" aria-label="What Agento sells" data-testid="selling">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <div className="font-pixel text-[12px] text-agent-ink">Selling</div>
          <h2 className="mt-0.5 text-[17px] font-semibold leading-snug">Other agents can pay Agento, too</h2>
          <p className="mt-0.5 max-w-[62ch] text-[13.5px] text-ink-2">
            {c.resources.length} answers are for sale per request in USDC on Arc, with no account or API key: an agent asks, gets the price, pays, and gets the answer.
          </p>
        </div>
        <div className="flex gap-5 text-right">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">From other agents</div>
            <div className="num text-[20px] font-semibold leading-tight" data-testid="earned-outside">{usd(s.outside.total)}</div>
            <div className="num text-[12px] text-ink-3">
              {s.outside.count} request{s.outside.count === 1 ? "" : "s"} · {s.outside.buyers} buyer{s.outside.buyers === 1 ? "" : "s"}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">From your own jobs</div>
            <div className="num text-[20px] font-semibold leading-tight text-ink-2">{usd(s.own.total)}</div>
            <div className="num text-[12px] text-ink-3">{s.own.count} request{s.own.count === 1 ? "" : "s"}</div>
          </div>
        </div>
      </div>

      {s.recent.length > 0 && (
        <ul className="border-t border-[#f1f0ec] px-4 py-2 text-[13px] sm:px-5" data-testid="sales">
          {s.recent.slice(0, 5).map((x) => (
            <li key={x.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1">
              <span className="min-w-0">
                <span className="font-medium">{x.product}</span> <span className="text-ink-3">· {x.own ? "one of your jobs" : `agent ${short(x.payer)}`}</span>
              </span>
              <span className="num text-ink-2">
                {usd(x.amount)} ·{" "}
                <a href={txUrl(x.tx)} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2">
                  payment
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-[#f1f0ec] px-4 py-2.5 sm:px-5">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink" data-testid="selling-toggle">
          <Icon name="chevron" size={13} className={open ? "rotate-90" : ""} /> {open ? "Hide" : "Show"} the price list
        </button>
        {open && (
          <div className="mt-2">
            <ul className="divide-y divide-[#f1f0ec] text-[13px]" data-testid="selling-list">
              {c.resources.map((r) => (
                <li key={r.resource} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="min-w-0">
                    <code className="text-[12.5px]">{new URL(r.resource).pathname}</code>
                    <span className="block text-[12.5px] text-ink-3">{r.description}</span>
                  </span>
                  <span className="num shrink-0 text-ink-2">{usd(r.priceUsd)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12.5px] text-ink-3">
              Paid to <span className="num">{short(c.payTo)}</span> on {c.network}. Machine-readable:{" "}
              <a href="/api/x402" className="underline decoration-line underline-offset-2">
                catalog
              </a>{" "}
              ·{" "}
              <a href="/api/x402/openapi.json" className="underline decoration-line underline-offset-2">
                OpenAPI spec
              </a>
              .
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
