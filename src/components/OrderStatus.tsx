"use client";
import { useEffect, useState } from "react";
import type { Run } from "@/lib/types";
import { actionText, conditionLabel, VenueBadge } from "./Chat";
import { Button, Spinner } from "./ui";
import { post } from "./useRun";
import { toast } from "./Toaster";

const STATUS: Record<string, { text: string; cls: string }> = {
  open: { text: "Open · resting on the exchange", cls: "text-agent" },
  filled: { text: "Filled", cls: "text-good" },
  cancelled: { text: "Cancelled", cls: "text-ink-3" },
  skipped: { text: "Held off: condition not met", cls: "text-[#7a5000]" },
  rejected: { text: "Refused by the exchange", cls: "text-bad" },
  simulated: { text: "Simulated · not sent to any exchange", cls: "text-[#7a5000]" },
};

/** The agreed move and what happened to it: condition check, then the order, live from the exchange. */
export function OrderStatus({ run }: { run: Run }) {
  const p = run.proposal!;
  const check = run.phases.find((x) => x.id === "check");
  const act = run.phases.find((x) => x.id === "act");
  const o = run.order;
  const [busy, setBusy] = useState<"" | "refresh" | "cancel">("");
  const trade = p.action && p.action.kind !== "itinerary";

  // Keep an open order current without the user asking.
  useEffect(() => {
    if (o?.status !== "open" || o.venue === "paper") return;
    const t = setInterval(() => void post(`/api/runs/${run.id}/order-refresh`).catch(() => undefined), 20_000);
    return () => clearInterval(t);
  }, [o?.status, o?.venue, run.id]);

  async function act2(kind: "refresh" | "cancel") {
    setBusy(kind);
    try {
      await post(`/api/runs/${run.id}/order-${kind}`);
      if (kind === "cancel") toast("Order cancelled", "good");
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy("");
    }
  }

  const tone = o?.status === "rejected" ? "border-bad/50" : o?.status === "skipped" || o?.status === "simulated" ? "border-warn" : o ? "border-good/50" : "border-line";
  const st = o ? STATUS[o.status] : undefined;
  return (
    <section className={`rounded-2xl border-2 bg-panel p-4 ${tone}`} aria-label="The move" data-testid="order-status">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-pixel text-[12px] uppercase tracking-wide text-agent">The move</div>
          <div className="mt-0.5 text-[16px] font-semibold">{p.title}</div>
        </div>
        {trade && <VenueBadge venue={o?.venue ?? p.venue ?? "paper"} />}
      </div>
      <div className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2">
        {p.condition && (
          <div className="rounded-lg border border-line p-2.5">
            <div className="text-[11px] uppercase tracking-wide text-ink-3">Check before placing</div>
            <div className="font-medium">{conditionLabel(p.condition)}</div>
            <div className="mt-0.5 text-[12px] text-ink-2">
              {check?.status === "done" ? (
                check.note
              ) : check?.status === "active" ? (
                <>
                  <Spinner /> checking…
                </>
              ) : (
                "after research"
              )}
            </div>
          </div>
        )}
        {p.action && (
          <div className="rounded-lg border border-line p-2.5">
            <div className="text-[11px] uppercase tracking-wide text-ink-3">{p.action.kind === "itinerary" ? "Plan" : "Order"}</div>
            <div className="font-medium">{actionText(p.action)}</div>
            <div className={`mt-0.5 text-[12px] ${st?.cls ?? "text-ink-2"}`} data-testid="order-result">
              {o ? (
                <>
                  {o.status === "rejected" ? o.detail : st?.text}
                  {o.orderId && o.venue !== "paper" && <span className="text-ink-3"> · #{o.orderId}</span>}
                </>
              ) : act?.status === "active" ? (
                "Sending…"
              ) : act?.status === "done" ? (
                act.note
              ) : (
                "waiting for the research"
              )}
            </div>
            {o && o.quantity != null && (o.status === "open" || o.status === "filled" || o.status === "cancelled") && (
              <div className="num mt-1 text-[12px] text-ink-3">
                Filled {o.filledQuantity ?? 0} of {o.quantity}
                {o.avgPrice ? ` · avg ${o.avgPrice < 1 ? `${Math.round(o.avgPrice * 100)}¢` : `$${o.avgPrice}`}` : ""}
                {o.updatedAt ? ` · checked ${new Date(o.updatedAt).toLocaleTimeString()}` : ""}
              </div>
            )}
            {o?.status === "open" && o.venue !== "paper" && (
              <div className="mt-2 flex gap-2">
                <Button variant="ghost" className="h-8 text-[12px]" disabled={!!busy} onClick={() => act2("refresh")} data-testid="order-refresh">
                  {busy === "refresh" ? <Spinner /> : "Refresh"}
                </Button>
                <Button variant="danger" className="h-8 text-[12px]" disabled={!!busy} onClick={() => act2("cancel")} data-testid="order-cancel">
                  {busy === "cancel" ? <Spinner /> : "Cancel order"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      {o?.status === "simulated" && (
        <p className="mt-2 text-[12px] text-ink-3">No exchange is connected, so nothing was bought. Connect Gemini sandbox keys to place real test orders.</p>
      )}
    </section>
  );
}
