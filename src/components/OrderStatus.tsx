"use client";
import type { Run } from "@/lib/types";
import { actionText, conditionLabel } from "./Chat";
import { Spinner } from "./ui";

const VENUE: Record<string, string> = { "gemini-sandbox": "Gemini sandbox · test money", gemini: "Gemini · real money", paper: "Paper trade · not sent to an exchange" };

/** The agreed move and what happened to it: condition check, then the order. */
export function OrderStatus({ run }: { run: Run }) {
  const p = run.proposal!;
  const check = run.phases.find((x) => x.id === "check");
  const act = run.phases.find((x) => x.id === "act");
  const o = run.order;
  const tone = o?.status === "rejected" ? "border-bad/50" : o?.status === "skipped" ? "border-warn" : o ? "border-good/50" : "border-line";
  return (
    <section className={`rounded-2xl border-2 bg-panel p-4 ${tone}`} aria-label="The move" data-testid="order-status">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-pixel text-[12px] uppercase tracking-wide text-agent">The move</div>
          <div className="mt-0.5 text-[16px] font-semibold">{p.title}</div>
        </div>
        {p.action && p.action.kind !== "itinerary" && <span className="text-[12px] text-ink-3">{VENUE[o?.venue ?? "paper"]}</span>}
      </div>
      <div className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2">
        {p.condition && (
          <div className="rounded-lg border border-line p-2.5">
            <div className="text-[11px] uppercase tracking-wide text-ink-3">Condition</div>
            <div className="font-medium">{conditionLabel(p.condition)}</div>
            <div className="mt-0.5 text-[12px] text-ink-2">
              {check?.status === "done" ? check.note : check?.status === "active" ? <><Spinner /> checking…</> : "after research"}
            </div>
          </div>
        )}
        {p.action && (
          <div className="rounded-lg border border-line p-2.5">
            <div className="text-[11px] uppercase tracking-wide text-ink-3">{p.action.kind === "itinerary" ? "Plan" : "Order"}</div>
            <div className="font-medium">{actionText(p.action)}</div>
            <div className={`mt-0.5 text-[12px] ${o?.status === "rejected" ? "text-bad" : o?.status === "skipped" ? "text-[#7a5000]" : o ? "text-good" : "text-ink-2"}`} data-testid="order-result">
              {o
                ? o.status === "skipped"
                  ? "Held off: condition not met"
                  : o.status === "rejected"
                    ? o.detail
                    : `${o.status === "filled" ? "Filled" : "Placed"}${o.orderId ? ` · #${o.orderId}` : ""}`
                : act?.status === "active"
                  ? "Sending…"
                  : act?.status === "done"
                    ? act.note
                    : "waiting for the check"}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
