"use client";
import type { Run } from "@/lib/types";
import { liveLine } from "@/lib/outcome";
import { Icon } from "./Icon";

/**
 * Where the order is, in two boxes: the real order on Gemini's test exchange (placed through its
 * prediction-market API, with its number and a link), and the same contract on the live market,
 * where people actually trade: whether it would have filled, at what price and when.
 */
export function OrderChips({ run }: { run: Run }) {
  const o = run.order;
  const a = run.proposal?.action;
  if (!o || a?.kind !== "prediction_order" || a.trade === "sell" || (o.venue !== "gemini-sandbox" && !o.shadow)) return null;
  const live = liveLine(o, a.maxPrice);
  const filledLive = o.shadow?.state === "filled";
  const state = o.status === "filled" ? "filled" : o.status === "cancelled" ? "cancelled" : o.status === "simulated" ? "practice" : "open";
  return (
    <div className="grid gap-2.5 sm:grid-cols-2" data-testid="order-chips">
      <div className="rounded-xl border-[1.5px] border-ink bg-panel px-3.5 py-2.5" data-testid="order-test">
        <div className="text-[11.5px] font-semibold tracking-wide text-ink-3">{o.venue === "gemini-sandbox" ? "GEMINI PREDICTION MARKET · TEST EXCHANGE" : "PRACTICE"}</div>
        <div className="mt-0.5 text-[15px] font-semibold">
          {state === "open" ? "Open" : state === "filled" ? "Filled" : state === "cancelled" ? "Cancelled" : "No order sent"}
          {o.orderId && o.venue === "gemini-sandbox" ? <span className="num text-ink-2"> · order #{o.orderId}</span> : null}
        </div>
        <div className="mt-0.5 text-[13px] text-ink-2">
          {a.quantity} × {a.side.toUpperCase()} at {Math.round(a.maxPrice * 100)}¢ or less
          {o.filledQuantity ? ` · ${o.filledQuantity} filled` : ""}
        </div>
        {o.venue === "gemini-sandbox" && (
          <>
            <div className="mt-1 break-all font-mono text-[11.5px] text-ink-3" data-testid="order-symbol">
              {a.symbol} · placed with the prediction-market API
            </div>
            <a href="https://exchange.sandbox.gemini.com/predictions" target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-agent-ink underline decoration-line underline-offset-2" data-testid="order-test-link">
              See it under Predictions on Gemini&apos;s test exchange <Icon name="external" size={11} />
            </a>
            <div className="mt-0.5 text-[11.5px] text-ink-3">Gemini also lists it under Trade → Order history.</div>
          </>
        )}
      </div>
      <div className={`rounded-xl border-[1.5px] px-3.5 py-2.5 ${filledLive ? "border-ink bg-agent-soft shadow-[3px_3px_0_0_var(--agent)]" : "border-line bg-panel"}`} data-testid="order-live" data-state={o.shadow?.state ?? "unknown"}>
        <div className="text-[11.5px] font-semibold tracking-wide text-ink-3">LIVE GEMINI MARKET</div>
        <div className="mt-0.5 text-[15px] font-semibold">{filledLive ? "Would have filled" : o.shadow ? "Not reached yet" : "Checking…"}</div>
        <div className="mt-0.5 text-[13px] text-ink-2">{live?.replace(/^Live market: /, "") ?? "Reading the live price for the same contract"}</div>
      </div>
    </div>
  );
}
