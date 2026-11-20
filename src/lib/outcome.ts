import { fmt } from "./money";
import type { OrderResult, Run } from "./types";

export interface Outcome {
  tone: "good" | "warn" | "bad" | "info";
  /** One line that answers "what's going on with my job right now?" */
  headline: string;
  /** One more line: what it means or what happens next. */
  detail?: string;
}

const VENUE = { paper: "practice", "gemini-sandbox": "Gemini's test exchange", gemini: "Gemini" } as const;
const price = (x: number) => (x < 1 ? `${Math.round(x * 100)}¢` : `$${x.toLocaleString()}`);

/** The state of a job in one or two plain sentences, from the facts on record. */
/** The live market beside a test-exchange or practice order, in one line. */
export function liveLine(o: OrderResult | undefined, limit?: number): string | undefined {
  const sh = o?.shadow;
  if (!sh) return undefined;
  if (sh.state === "filled") return `Live market: would have filled at ${price(sh.price ?? 0)}${sh.at ? ` at ${new Date(sh.at).toUTCString().slice(17, 22)} UTC` : ""}`;
  return sh.liveAsk != null ? `Live market: cheapest seller at ${price(sh.liveAsk)}${limit != null ? `, waiting for your ${price(limit)}` : ""}` : "Live market: no sellers right now";
}

export function outcomeOf(run: Run): Outcome {
  const o = run.order;
  const needs = run.pendingFailures.length + run.pendingReapprovals.length;
  const selling = run.proposal?.action?.kind === "prediction_order" ? run.proposal.action.trade === "sell" : run.proposal?.action?.kind === "spot_order" && run.proposal.action.side === "sell";

  if (run.status === "exploring") return { tone: "info", headline: "Chatting: nothing has been spent" };
  if (run.status === "draft") return { tone: "info", headline: "Waiting for your approval" };
  if (run.status === "funding") return { tone: "info", headline: "Setting aside the budget…", detail: "Putting it in a locked account that can only pay what you approved." };

  if (run.status === "running") {
    if (needs) {
      const f = run.pendingFailures[0];
      const r = run.pendingReapprovals[0];
      return { tone: "warn", headline: "Paused: it needs your decision", detail: f ? f.message : r ? `${r.to.payeeName} is asking ${fmt(r.to.amount)} USDC instead of ${fmt(r.from.amount)}.` : undefined };
    }
    const active = run.phases.find((p) => p.status === "active");
    const at = run.phases.filter((p) => p.status === "done" || p.status === "skipped").length + 1;
    return { tone: "info", headline: active ? `Step ${Math.min(at, run.phases.length)} of ${run.phases.length}: ${active.label}` : "Working…", detail: active?.note };
  }

  if (run.status === "cancelled") {
    const back = BigInt(run.refunded ?? 0);
    return { tone: "warn", headline: "Stopped", detail: back > 0n ? `${fmt(back)} USDC you hadn't spent came back.` : o?.status === "cancelled" ? "The order was cancelled too." : "Nothing more will be spent." };
  }

  // done
  const s = run.settlement;
  if (s) {
    const would = s.practice ? "would have " : "";
    const what = run.proposal?.hedge ? "Your cover" : "It";
    return s.won
      ? { tone: "good", headline: `${what} ${would}paid $${s.paid.toFixed(2)}`, detail: `The market resolved your way. ${s.quantity} contract${s.quantity === 1 ? "" : "s"} cost $${s.cost.toFixed(2)}${s.practice ? " (practice: no real money moved)" : ""}.` }
      : {
          tone: "warn",
          headline: run.proposal?.hedge ? `The thing you covered didn't happen` : `It resolved the other way`,
          detail: `${s.practice ? "It would have cost" : "It cost"} $${s.cost.toFixed(2)} and ${would}paid nothing${run.proposal?.hedge ? ", like insurance you didn't need" : ""}.${s.legs ? ` ${s.legs.filter((l) => l.resolved && l.resolved !== l.side).map((l) => `“${l.label}” didn't come in`).join("; ")}.` : ""}`,
        };
  }
  if (o && run.proposal?.action && run.proposal.action.kind !== "itinerary") {
    const of = o.quantity != null ? `${o.filledQuantity ?? 0} of ${o.quantity}` : "";
    const limit = run.proposal.action.kind === "prediction_order" ? run.proposal.action.maxPrice : undefined;
    const live = liveLine(o, limit);
    const closes = run.proposal.market?.closesAt ? Date.parse(run.proposal.market.closesAt) : NaN;
    const closedNoFill = o.shadow?.state === "waiting" && !(o.filledQuantity ?? 0) && Number.isFinite(closes) && closes <= Date.now();
    switch (o.status) {
      case "simulated":
        return live
          ? { tone: "warn", headline: closedNoFill ? `Practice run: it wouldn't have filled, the live market never came down to ${price(limit ?? 0)}` : "Practice run: no order was sent", detail: `${live}. No money moved.` }
          : { tone: "warn", headline: "Practice run: no order was sent", detail: "No exchange is connected, so nothing was bought or sold. Connect Gemini in Settings to place real orders." };
      case "open":
        if (o.venue === "gemini-sandbox")
          return {
            tone: closedNoFill ? "warn" : "info",
            headline: closedNoFill ? `It wouldn't have filled: the live market never came down to ${price(limit ?? 0)}` : `Open on Gemini's test exchange${o.orderId ? ` · order #${o.orderId}` : ""}${of ? ` (${of} filled)` : ""}`,
            detail: `${live ? `${live}. ` : ""}Placed through Gemini's prediction-market API. It stays open there until a test-exchange seller matches it, and you can cancel it any time.`,
          };
        return {
          tone: "info",
          headline: `Order placed, waiting to ${selling ? "sell" : "fill"}${of ? ` (${of} so far)` : ""}`,
          detail: `It sits on ${VENUE[o.venue]} until someone takes the other side. You'll be told when it fills, and you can cancel it any time.`,
        };
      case "filled":
        return { tone: "good", headline: `${selling ? "Sold" : "Filled"}${o.quantity != null ? `: ${o.quantity}` : ""}${o.avgPrice ? ` at ${price(o.avgPrice)} average` : ""}`, detail: `Done on ${VENUE[o.venue]}.` };
      case "cancelled":
        return { tone: "warn", headline: `Order cancelled${of ? ` (${of} filled before that)` : ""}` };
      case "skipped":
        return { tone: "warn", headline: "No order placed", detail: o.detail.replace(/^Not placed:\s*/, "The check didn't pass: ") };
      case "rejected":
        return { tone: "bad", headline: "The exchange refused the order", detail: o.detail };
    }
  }
  return { tone: "good", headline: run.deliverable?.summary ?? "Done", detail: undefined };
}
