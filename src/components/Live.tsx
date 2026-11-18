"use client";
import { useEffect, useMemo, useState } from "react";
import type { MoveAction, Proposal, Settlement, Venue } from "@/lib/types";
import type { Tick } from "@/server/live";
import { cents, legText } from "@/lib/move";
import { chance, outcomeOf } from "@/lib/plain";
import { Icon } from "./Icon";

type Watch = { eventTicker: string; symbol: string };

/** Live prices for a few contracts, from the server's stream. Empty until the first reading arrives. */
export function useLive(watches: Watch[], venue?: Venue, on = true): Record<string, Tick> {
  const key = watches.map((w) => `${w.eventTicker}:${w.symbol}`).join("|");
  const [ticks, setTicks] = useState<Record<string, Tick>>({});
  useEffect(() => {
    if (!on || !key || typeof EventSource === "undefined") return;
    const q = new URLSearchParams();
    for (const w of key.split("|")) q.append("w", w);
    if (venue === "gemini-sandbox") q.set("venue", venue);
    const es = new EventSource(`/api/live?${q}`);
    es.onmessage = (e) => {
      try {
        const list = JSON.parse(e.data) as Tick[];
        setTicks((prev) => ({ ...prev, ...Object.fromEntries(list.map((t) => [t.symbol, t])) }));
      } catch {
        /* a bad frame is skipped */
      }
    };
    return () => es.close();
  }, [key, venue, on]);
  return ticks;
}

const usd = (x: number) => `$${x.toLocaleString(undefined, { maximumFractionDigits: x < 10 ? 4 : x < 1000 ? 2 : 0 })}`;
/** What an outcome costs to buy and what selling it gets, from the YES book. */
const sideOf = (t: Tick | undefined, side: "yes" | "no") => ({
  buy: !t ? null : side === "yes" ? t.ask : t.bid != null ? Math.round((1 - t.bid) * 100) / 100 : null,
  sell: !t ? null : side === "yes" ? t.bid : t.ask != null ? Math.round((1 - t.ask) * 100) / 100 : null,
});

function LiveDot({ t }: { t?: Tick }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3" title={t ? (t.via === "stream" ? "Streaming from Gemini" : "Refreshed every few seconds") : "Connecting"}>
      <span className={`h-1.5 w-1.5 rounded-full ${t ? "bg-good animate-pulse motion-reduce:animate-none" : "bg-line"}`} aria-hidden /> Live
    </span>
  );
}

/**
 * How far the real price is from the level the contract is about: a bar from the price to the
 * strike, so "will this pay?" is something you can watch.
 */
function StrikeMeter({ t, side, label }: { t: Tick; side: "yes" | "no"; label: string }) {
  if (t.strike == null || t.spot == null || !t.spotSymbol) return null;
  const coin = t.spotSymbol.replace(/usd$/, "").toUpperCase();
  const above = t.spot >= t.strike;
  // "X or above" pays YES when the price is at or over the strike; "or below" the other way round.
  const yesWhenAbove = !/below|under/i.test(label);
  const paying = (above === yesWhenAbove) === (side === "yes");
  const gap = Math.abs(t.spot - t.strike);
  const pct = t.strike ? (gap / t.strike) * 100 : 0;
  // The strike sits in the middle; the price slides up to 5% either side of it.
  const pos = Math.max(4, Math.min(96, 50 + ((t.spot - t.strike) / t.strike) * 1000));
  return (
    <div className="mt-2.5" data-testid="strike-meter" data-paying={paying ? "yes" : "no"}>
      <div className="relative h-2 rounded-full bg-line/60" aria-hidden>
        <span className="absolute left-1/2 top-[-3px] h-[14px] w-[2px] -translate-x-1/2 bg-ink" />
        <span className={`absolute top-[-2px] h-3 w-3 -translate-x-1/2 rounded-full border-2 border-panel transition-[left] duration-700 ${paying ? "bg-good" : "bg-warn"}`} style={{ left: `${pos}%` }} />
      </div>
      <p className="num mt-1.5 text-[12.5px] text-ink-2">
        {coin} is at {usd(t.spot)}, {usd(gap)} ({pct.toFixed(pct < 1 ? 2 : 1)}%) {above ? "above" : "below"} the {usd(t.strike)} line.{" "}
        <span className={paying ? "font-semibold text-good" : "text-ink-3"}>{paying ? "It would pay if it closed now." : "It wouldn't pay if it closed now."}</span>
      </p>
    </div>
  );
}

function closesIn(iso?: string) {
  if (!iso) return "";
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "closed";
  const m = Math.round(ms / 60_000);
  return m < 90 ? `closes in ${m} min` : m < 48 * 60 ? `closes in ${Math.round(m / 60)} h` : `closes in ${Math.round(m / 1440)} days`;
}

/**
 * The live side of a prediction order: what it costs right now, how close the real price is to
 * the line, and for a combination every outcome that has to come true. Shown while shaping a
 * move and again on the job once it runs.
 */
export function LiveMarket({ action, hedge, venue, settlement, held }: { action: MoveAction; hedge?: Proposal["hedge"]; venue?: Venue; settlement?: Settlement; /** Contracts actually held (or simulated), for "worth now". */ held?: number }) {
  const a = action.kind === "prediction_order" ? action : undefined;
  const watches = useMemo<Watch[]>(() => (!a ? [] : a.combo ? a.combo.legs.map((l) => ({ eventTicker: l.eventTicker, symbol: l.symbol })) : [{ eventTicker: a.eventTicker, symbol: a.symbol }]), [a]);
  const ticks = useLive(watches, venue, !settlement);
  if (!a || a.trade === "sell") return null;
  const first = ticks[watches[0]?.symbol];
  const cost = a.maxPrice * a.quantity;

  if (a.combo) {
    const legs = a.combo.legs.map((l) => {
      const t = ticks[l.symbol];
      const done = settlement?.legs?.find((x) => x.label === l.label)?.resolved ?? t?.resolved;
      return { l, t, price: sideOf(t, l.side).buy ?? l.price, done };
    });
    const fair = legs.every((x) => x.price != null) ? Math.max(0.01, legs.reduce((p, x) => p * (x.price as number), 1)) : null;
    const apart = legs.every((x) => x.price != null) ? legs.reduce((p, x) => p + (x.price as number), 0) : null;
    return (
      <section className="rounded-2xl border-[1.5px] border-ink bg-panel shadow-[3px_3px_0_0_var(--agent)]" aria-label="Your cover" data-testid="policy-card">
        <div className="flex items-center justify-between gap-2 border-b border-[#f1f0ec] px-4 py-2.5">
          <div className="font-pixel text-[12px] text-agent-ink">{hedge ? "Your cover" : "Pays only if all of these happen"}</div>
          <LiveDot t={first} />
        </div>
        <div className="px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Costs at most</div>
              <div className="num text-[22px] font-semibold leading-tight" data-testid="policy-cost">${cost.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">Pays if all {legs.length} happen</div>
              <div className="num text-[22px] font-semibold leading-tight text-good" data-testid="policy-payout">${a.quantity.toFixed(2)}</div>
            </div>
          </div>
          {hedge && <p className="mt-1.5 text-[13px] text-ink-2">Protects {hedge.protects}: covers {Math.round((hedge.covered / hedge.lossUsd) * 100)}% of a ${hedge.lossUsd} loss.</p>}
          <ol className="mt-3 space-y-1.5" data-testid="policy-legs">
            {legs.map(({ l, price, done }) => {
              const hit = done ? done === l.side : undefined;
              return (
                <li key={l.symbol} className="flex items-start gap-2 rounded-lg border border-line px-2.5 py-2 text-[13px]" data-testid="policy-leg">
                  <span className={`mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] ${hit === true ? "bg-good text-white" : hit === false ? "bg-bad text-white" : "border-[1.5px] border-ink-3/60"}`} aria-hidden>
                    {hit === true ? <Icon name="check" size={11} stroke={3} /> : hit === false ? <Icon name="x" size={11} stroke={3} /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">
                      {legText(l)}
                    </span>
                    <span className="block text-[12px] text-ink-3">{l.event}</span>
                  </span>
                  <span className="num shrink-0 text-right text-[12.5px] text-ink-2">
                    {hit === true ? "happened" : hit === false ? "didn't happen" : price != null ? `${chance(price)} on its own` : "no seller"}
                  </span>
                </li>
              );
            })}
          </ol>
          {!settlement && (
            <p className="num mt-2.5 text-[12.5px] text-ink-3" data-testid="policy-fair">
              {fair != null ? `Together they're worth about ${cents(fair)} per $1 of cover right now` : "No fair price right now: one of them has no seller"}
              {apart != null ? ` · ${cents(apart)} if you bought each separately` : ""} · you pay at most {cents(a.maxPrice)}
            </p>
          )}
          <p className="mt-1.5 text-[12.5px] text-ink-3">It pays only if every one of these happens. If any one doesn't, it pays nothing and you lose what it cost.</p>
        </div>
      </section>
    );
  }

  if (settlement) return null;
  const { buy, sell } = sideOf(first, a.side);
  const worth = held && sell != null ? held * sell : null;
  return (
    <section className="rounded-2xl border border-line bg-panel px-4 py-3" aria-label="Live market" data-testid="live-market">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-[13px] font-semibold">
          {a.event ? `${a.event}: ` : ""}
          {outcomeOf(a)}
        </div>
        <LiveDot t={first} />
      </div>
      <p className="num mt-1 text-[13px] text-ink-2" data-testid="live-price">
        {!first ? "Reading the market…" : first.resolved ? (first.resolved === a.side ? "It happened: this paid out" : "It didn't happen: this paid nothing") : `${buy != null ? `Costs ${cents(buy)} now for each $1 it can pay (${chance(buy)})` : "Nobody is selling right now"}${sell != null ? ` · sells for ${cents(sell)}` : ""}${closesIn(first.closesAt) ? ` · ${closesIn(first.closesAt)}` : ""}`}
        {buy != null && !first?.resolved ? (buy <= a.maxPrice ? " · within the price you set" : " · above the price you set, so it waits") : ""}
      </p>
      {worth != null && !first?.resolved && (
        <p className="num mt-0.5 text-[12.5px] text-ink-3" data-testid="live-worth">
          What you hold would sell for about ${worth.toFixed(2)} now (you paid up to ${(held! * a.maxPrice).toFixed(2)}).
        </p>
      )}
      {first && !first.resolved && <StrikeMeter t={first} side={a.side} label={a.label} />}
    </section>
  );
}
