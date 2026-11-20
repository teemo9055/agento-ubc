"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import { contractName } from "@/lib/contract-name";

type Order = { orderId: string; symbol: string; side: "buy" | "sell"; outcome: "yes" | "no"; price: number; quantity: number; filled: number; status: string; createdAt?: string; runId?: string };
type Held = { symbol: string; label: string; event: string; outcome: "yes" | "no"; quantity: number; avgPrice: number; sellPrice: number | null; runId?: string };
type Account = { venue: string; venueName: string; error?: string; openOrders: Order[]; positions: Held[]; recent: Order[] };

const cents = (x: number) => `${Math.round(x * 100)}¢`;

/**
 * Your prediction-market account on Gemini, read from Gemini's own API: orders waiting to fill,
 * contracts you hold, and what filled lately. Each one links to the Agento job that placed it.
 */
export function GeminiAccount() {
  const [a, setA] = useState<Account | null>(null);
  useEffect(() => {
    let on = true;
    const load = () =>
      fetch("/api/trading/board", { cache: "no-store" })
        .then((r) => r.json())
        .then((x: { gemini?: Account }) => on && x.gemini && setA(x.gemini))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 20_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, []);
  if (!a || a.venue === "paper") return null;
  const empty = !a.openOrders.length && !a.positions.length && !a.recent.length;
  return (
    <section className="rounded-2xl border-[1.5px] border-ink bg-panel p-4 shadow-[4px_4px_0_0_var(--agent)] sm:p-5" aria-label="Your Gemini predictions" data-testid="gemini-account">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-pixel text-[12px] text-agent-ink">YOUR GEMINI PREDICTIONS</div>
          <div className="mt-0.5 text-[13px] text-ink-3">Read live from Gemini&apos;s prediction-market API · {a.venueName}</div>
        </div>
        <a href={a.venue === "gemini" ? "https://exchange.gemini.com/predictions" : "https://exchange.sandbox.gemini.com/predictions"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-agent-ink underline decoration-line underline-offset-2">
          Open on Gemini <Icon name="external" size={11} />
        </a>
      </div>
      {a.error ? (
        <p className="mt-3 text-[13.5px] text-bad">Couldn&apos;t read the account: {a.error}</p>
      ) : empty ? (
        <p className="mt-3 text-[13.5px] text-ink-2">No prediction orders on Gemini yet.</p>
      ) : (
        <div className="mt-3 grid gap-3">
          <Group title="Waiting to fill" sub="Open orders: on the book until a seller matches your price" n={a.openOrders.length}>
            {a.openOrders.map((o) => (
              <Tile key={o.orderId} title={contractName(o.symbol)} line={`${o.side === "sell" ? "Sell" : "Buy"} ${o.outcome.toUpperCase()} · ${o.quantity} at ${cents(o.price)} or ${o.side === "sell" ? "more" : "less"}`} note={`order #${o.orderId}${o.filled ? ` · ${o.filled} filled` : ""}`} runId={o.runId} tone="wait" />
            ))}
          </Group>
          <Group title="You hold" sub="Filled contracts: each pays $1 if it resolves your way" n={a.positions.length}>
            {a.positions.map((p) => (
              <Tile key={`${p.symbol}:${p.outcome}`} title={contractName(p.symbol)} line={`${p.quantity} × ${p.outcome.toUpperCase()} · bought at ${cents(p.avgPrice)}`} note={p.sellPrice != null ? `sells for ${cents(p.sellPrice)} now` : "no buyer right now"} runId={p.runId} tone="held" />
            ))}
          </Group>
          <Group title="Recently filled" sub="From Gemini's order history" n={a.recent.length}>
            {a.recent.map((o) => (
              <Tile key={o.orderId} title={contractName(o.symbol)} line={`${o.side === "sell" ? "Sold" : "Bought"} ${o.filled} ${o.outcome.toUpperCase()} at ${cents(o.price)} or better`} note={`order #${o.orderId}`} runId={o.runId} tone="done" />
            ))}
          </Group>
        </div>
      )}
    </section>
  );
}

function Group({ title, sub, n, children }: { title: string; sub: string; n: number; children: React.ReactNode }) {
  if (!n) return null;
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-[14px] font-semibold">{title}</span>
        <span className="rounded-full bg-ink/5 px-2 text-[12px] font-semibold text-ink-2">{n}</span>
        <span className="text-[12px] text-ink-3">{sub}</span>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Tile({ title, line, note, runId, tone }: { title: string; line: string; note: string; runId?: string; tone: "wait" | "held" | "done" }) {
  const dot = tone === "wait" ? "bg-warn" : tone === "held" ? "bg-agent" : "bg-good";
  const body = (
    <div className="h-full rounded-xl border-[1.5px] border-line bg-surface px-3 py-2.5 transition-colors hover:border-ink" data-testid="gemini-order">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-[3px] ${dot}`} aria-hidden />
        <span className="truncate text-[14px] font-semibold">{title}</span>
      </div>
      <div className="mt-0.5 text-[13px] text-ink-2">{line}</div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-[12px] text-ink-3">
        <span className="num">{note}</span>
        {runId && <span className="font-medium text-agent-ink">see the job →</span>}
      </div>
    </div>
  );
  return runId ? <Link href={`/runs/${runId}`}>{body}</Link> : body;
}
