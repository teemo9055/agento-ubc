"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Proposal } from "@/lib/types";
import { chance, doesLine, outcomeOf } from "@/lib/plain";
import { Icon } from "./Icon";

const money = (x: number) => `$${x > 0 && x < 0.01 ? x.toFixed(4) : Number.isInteger(x) ? x : x.toFixed(2)}`;
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC" : undefined);

function Row({ k, children, testid }: { k: string; children: React.ReactNode; testid?: string }) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3 py-2 text-[13.5px] sm:grid-cols-[132px_minmax(0,1fr)]" data-testid={testid}>
      <dt className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">{k}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/**
 * Inso: the cover, organized. What it protects you against, which market it uses, how much you pay
 * and get, when it's decided, and one sentence on what this ensures.
 */
export function CoverSheet({ p }: { p: Proposal }) {
  const a = p.action;
  if (a?.kind !== "prediction_order" || a.trade === "sell") return null;
  const cost = Math.round(a.maxPrice * a.quantity * 100) / 100;
  const pays = a.quantity;
  const h = p.hedge;
  const outcome = a.combo ? `all ${a.combo.legs.length} of these happen` : `“${outcomeOf(a)}”`;
  const closes = when(p.market?.closesAt);
  return (
    <section className="rounded-xl border border-line bg-panel px-4 py-2" aria-label="Your cover" data-testid="cover-sheet">
      <dl className="divide-y divide-[#f1f0ec]">
        <Row k={h ? "Protects" : "Bets on"}>
          <span className="font-semibold">{h ? h.protects : outcome}</span>
          {h && <span className="block text-ink-2">a loss of about {money(h.lossUsd)} if it happens</span>}
        </Row>
        <Row k="Uses">
          {a.combo ? (
            <ul className="space-y-0.5">
              {a.combo.legs.map((l) => (
                <li key={l.symbol}>
                  {l.event ? <span className="text-ink-2">{l.event}: </span> : null}
                  {outcomeOf({ label: l.label, side: l.side })}
                </li>
              ))}
            </ul>
          ) : (
            <>
              <span className="font-medium">{a.event ?? "Prediction market"}</span>
              <span className="block text-ink-2">pays if {outcome}</span>
            </>
          )}
        </Row>
        <Row k="You pay" testid="cover-pay">
          <span className="num font-semibold">up to {money(cost)}</span> <span className="text-ink-2">now, once</span>
        </Row>
        <Row k="You get" testid="cover-get">
          <span className="num font-semibold">{money(pays)}</span> <span className="text-ink-2">if it happens · the market puts that at {chance(a.maxPrice)}</span>
        </Row>
        {closes && <Row k="Decided">{closes}</Row>}
      </dl>
      <p className="border-t border-[#f1f0ec] py-2.5 text-[13.5px] leading-snug" data-testid="cover-ensures">
        <Icon name="shield" size={14} className="mr-1.5 inline text-agent-ink" />
        {h
          ? `If you face ${h.protects}, this pays ${money(h.payout)}, about ${Math.round((h.covered / h.lossUsd) * 100)}% of your ${money(h.lossUsd)} loss. If not, the ${money(cost)} is what the cover cost.`
          : `If ${outcome} happens you get ${money(pays)}; if not, you're out the ${money(cost)} it cost.`}
      </p>
    </section>
  );
}

interface Board {
  venue: string;
  venueName: string;
  connected: boolean;
  cash: number | null;
  inOrders: number;
  bought: { runId: string; title: string; what: string; practice: boolean }[];
  sold: { runId: string; title: string; what: string; practice: boolean }[];
  pending: { runId: string; title: string; what: string; notional: number }[];
  holdings: { label: string; event: string; outcome: "yes" | "no"; quantity: number; available: number; sellPrice: number | null }[];
}

export function useBoard() {
  const [b, setB] = useState<Board | null>(null);
  useEffect(() => {
    let on = true;
    const load = () =>
      fetch("/api/trading/board")
        .then((r) => r.json())
        .then((x: Board) => on && setB(x))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 20_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, []);
  return b;
}

const KIND = {
  buy: { mark: "+", bar: "bg-good", chip: "bg-good text-white", label: "Buy", hint: "Orders that buy" },
  sell: { mark: "−", bar: "bg-bad", chip: "bg-bad text-white", label: "Sell", hint: "What you hold" },
  pending: { mark: "…", bar: "bg-warn", chip: "bg-warn text-ink", label: "Pending", hint: "Waiting for your price" },
  balance: { mark: "$", bar: "bg-ink", chip: "bg-ink text-white", label: "Balance", hint: "Your cash" },
} as const;

/** One column of the board: a coloured bar, a symbol and a plain hint, so the four never look alike. */
function Section({ kind, children, testid, empty }: { kind: keyof typeof KIND; children: React.ReactNode; testid: string; empty?: string }) {
  const k = KIND[kind];
  const has = Array.isArray(children) ? children.flat().filter(Boolean).length > 0 : Boolean(children);
  return (
    <section className={`flex min-w-0 flex-col ${kind === "balance" ? "bg-[#f6f5f1]" : "bg-panel"}`} data-testid={testid} aria-label={k.label}>
      <span className={`h-1.5 w-full ${k.bar}`} aria-hidden />
      <div className="flex items-center gap-2.5 px-4 pb-2 pt-3">
        <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-pixel text-[15px] leading-none ${k.chip}`} aria-hidden>
          {k.mark}
        </span>
        <span className="min-w-0">
          <h3 className="text-[14px] font-semibold leading-tight">{k.label}</h3>
          <p className="truncate text-[11.5px] text-ink-3">{k.hint}</p>
        </span>
      </div>
      <ul className="flex-1 space-y-2 px-4 pb-4 text-[13px] leading-snug">{has ? children : <li className="text-ink-3">{empty ?? "Nothing yet"}</li>}</ul>
    </section>
  );
}

const NEW = <span className="mb-1 inline-block rounded bg-agent px-1.5 py-px text-[10.5px] font-semibold text-agent-on">This order</span>;

/** The order being made, set apart from what already happened. */
function Draft({ children }: { children: React.ReactNode }) {
  return <li className="rounded-lg border-[1.5px] border-ink bg-agent-soft px-2.5 py-2 shadow-[2px_2px_0_0_var(--agent)]">{children}</li>;
}

/**
 * Trado: your trading at a glance, in four boxes: buy, sell, pending (orders waiting for their
 * price) and balance. While shaping, the order being made sits in its box, marked.
 */
export function TradeBoard({ p }: { p?: Proposal }) {
  const b = useBoard();
  const a = p?.action && p.action.kind !== "itinerary" ? p.action : undefined;
  const sell = a ? (a.kind === "prediction_order" && a.trade === "sell") || (a.kind === "spot_order" && a.side === "sell") : false;
  const line = a ? doesLine(a) : undefined;
  // A limit away from today's price waits on the exchange until the price comes to it.
  const waits = a?.kind === "spot_order" || (a?.kind === "prediction_order" && p?.market?.ask != null && !sell && a.maxPrice < p.market.ask);
  const cost = a ? (a.kind === "spot_order" ? (sell ? 0 : a.amountUsd) : sell ? 0 : a.maxPrice * a.quantity) : 0;
  const practice = !b || b.venue === "paper";
  return (
    <div className="grid gap-px overflow-hidden rounded-2xl border-[1.5px] border-ink bg-line shadow-[3px_3px_0_0_var(--agent)] sm:grid-cols-2 xl:grid-cols-4" aria-label="Your trading" data-testid="trade-board">
      <Section kind="buy" testid="board-buy" empty="No buys yet">
        {a && !sell && line && (
          <Draft>
            {NEW}
            <span className="block font-semibold">{line.label}</span>
            <span className="block text-ink-2">{line.detail}</span>
          </Draft>
        )}
        {b?.bought.map((o) => (
          <li key={o.runId}>
            <Link href={`/runs/${o.runId}`} className="font-medium hover:underline">
              {o.title}
            </Link>
            {o.practice && <span className="block text-[12px] text-ink-3">practice</span>}
          </li>
        ))}
      </Section>
      <Section kind="sell" testid="board-sell" empty={practice ? "Nothing held: no exchange is connected" : "Nothing held to sell"}>
        {a && sell && line && (
          <Draft>
            {NEW}
            <span className="block font-semibold">{line.label}</span>
            <span className="block text-ink-2">{line.detail}</span>
          </Draft>
        )}
        {b?.holdings.map((h) => (
          <li key={h.label + h.outcome}>
            <span className="block font-medium">
              {h.quantity} × {outcomeOf({ label: h.label, side: h.outcome })}
            </span>
            <span className="block text-[12px] text-ink-3">
              {h.event}
              {h.sellPrice != null ? ` · sells for ${Math.round(h.sellPrice * 100)}¢ each` : ""}
            </span>
          </li>
        ))}
      </Section>
      <Section kind="pending" testid="board-pending" empty="No orders waiting">
        {a && waits && (
          <Draft>
            {NEW}
            <span className="block text-ink-2">waits here until the price reaches your limit; cancel any time</span>
          </Draft>
        )}
        {b?.pending.map((o) => (
          <li key={o.runId} className="flex justify-between gap-2">
            <Link href={`/runs/${o.runId}`} className="min-w-0 font-medium hover:underline">
              {o.title}
            </Link>
            <span className="num shrink-0 text-ink-2">{money(o.notional)}</span>
          </li>
        ))}
      </Section>
      <Section kind="balance" testid="board-balance">
        {practice ? (
          <li className="text-ink-2">
            Practice: no exchange is connected, so there&apos;s no cash here.{" "}
            <Link href="/settings" className="underline underline-offset-2">
              Connect one
            </Link>
          </li>
        ) : (
          <>
            <li className="flex justify-between gap-2">
              <span className="text-ink-2">Cash</span>
              <span className="num font-semibold">{b?.cash != null ? money(b.cash) : "—"}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span className="text-ink-2">In open orders</span>
              <span className="num font-semibold">{money(b?.inOrders ?? 0)}</span>
            </li>
            {a && cost > 0 && b?.cash != null && (
              <li className="flex justify-between gap-2 border-t border-line pt-2">
                <span className="text-ink-2">After this order</span>
                <span className="num font-semibold">{money(Math.max(0, b.cash - cost))}</span>
              </li>
            )}
          </>
        )}
      </Section>
    </div>
  );
}

/** What a trip request is about, read from what was asked: only these parts are shown. */
export function tripParts(text: string) {
  const t = text.toLowerCase();
  return {
    ride: /\b(ride|taxi|uber|lyft|pick ?up|pickup|car to|get to)\b/.test(t),
    stay: /\b(hotel|stay|night|nights|lodging|airbnb|motel)\b/.test(t),
    food: /\b(restaurant|dinner|lunch|breakfast|eat|food|table|reservation)\b/.test(t),
    drive: /\b(drive|road trip|route|from .+ to )\b/.test(t),
  };
}

/**
 * Worko: the details of the trip, only the parts that matter for this request (the ride, the drive,
 * where to stay, where to eat), each with what's known so far.
 */
export function TripSheet({ p, task }: { p?: Proposal; task: string }) {
  const parts = tripParts(task);
  const a = p?.action?.kind === "itinerary" ? p.action : undefined;
  const lookups = p?.research ?? [];
  const has = (re: RegExp) => lookups.find((r) => re.test(`${r.tool} ${r.label} ${JSON.stringify(r.args)}`));
  const rows: { k: string; v: React.ReactNode; show: boolean; testid: string }[] = [
    { k: "Ride", show: parts.ride, testid: "trip-ride", v: <span className="text-ink-2">{has(/route|drive/) ? "Worko works out the route and how long the ride takes." : "Worko can work out the route and how long the ride takes."} It can&apos;t book the car: you do that in your ride app.</span> },
    { k: "Drive", show: Boolean(a) || parts.drive, testid: "trip-drive", v: a ? <span><span className="font-medium">{a.stops.join(" → ")}</span><span className="block text-ink-2">at most {a.hoursPerDay} h of driving a day</span></span> : <span className="text-ink-2">Say where from and where to.</span> },
    { k: "Stay", show: parts.stay, testid: "trip-stay", v: <span className="text-ink-2">{has(/hotel|stay|lodging/) ? "Worko lists places to stay near each stop." : "Worko lists places to stay near each night's stop."} You book the one you like yourself.</span> },
    { k: "Food", show: parts.food, testid: "trip-food", v: <span className="text-ink-2">Worko lists places to eat nearby. It can&apos;t book a table.</span> },
  ];
  const shown = rows.filter((r) => r.show);
  if (!shown.length) return null;
  return (
    <section className="rounded-xl border border-line bg-panel px-4 py-2" aria-label="Trip details" data-testid="trip-sheet">
      <dl className="divide-y divide-[#f1f0ec]">
        {shown.map((r) => (
          <Row key={r.k} k={r.k} testid={r.testid}>
            {r.v}
          </Row>
        ))}
      </dl>
    </section>
  );
}
