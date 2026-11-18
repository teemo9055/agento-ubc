import type { Run } from "./types";
import { paidInUsdc } from "./types";

/** One thing that can go wrong, and what happens then. */
export interface Risk {
  if: string;
  then: string;
}

const money = (x: number) => `$${x < 0.01 && x > 0 ? x.toFixed(4) : x.toFixed(2)}`;

/**
 * What can go wrong with this job and what happens if it does, from how the job is actually
 * built: who gets paid, whether there is a check, whether an order rests on an exchange.
 * Written by code from the work order, so it never promises a fallback the engine doesn't have.
 */
export function risksOf(run: Pick<Run, "proposal" | "lines">): Risk[] {
  const p = run.proposal;
  if (!p) return [];
  const a = p.action;
  const out: Risk[] = [];
  const paid = run.lines.filter((l) => paidInUsdc(l.rail));
  const data = paid.reduce((s, l) => s + Number(l.approved) / 1e6, 0);
  const trade = a && a.kind !== "itinerary";
  const selling = (a?.kind === "prediction_order" && a.trade === "sell") || (a?.kind === "spot_order" && a.side === "sell");

  if (paid.length)
    out.push({
      if: paid.length === 1 ? "The data seller doesn't answer, or asks for more" : "A data seller doesn't answer, or asks for more",
      then: "The job pauses and asks you: try again, skip it, or stop. It can never pay more than the amounts shown.",
    });
  if (paid.length)
    out.push({
      if: "A seller sends an empty or wrong answer",
      then: paid.some((l) => l.rail === "gateway")
        ? "It isn't used. Our own seller sends the money back; an outside seller is paused after two misses, and you aren't charged for its miss."
        : "It isn't used, and the seller sends the money back. A seller that misses twice in a day is paused.",
    });
  if (p.condition && trade) out.push({ if: "The check doesn't pass", then: `Nothing is ${selling ? "sold" : "bought"}.${data > 0 ? ` The lookups already paid for (${money(data)}) stay paid.` : ""}` });
  if (trade && p.venue === "paper") out.push({ if: "No exchange is connected", then: "This runs as practice: the order is priced from the real market but never sent, and no order money moves." });
  if (trade && p.venue !== "paper")
    out.push({
      if: selling ? "Nobody buys at your price" : "Nobody sells at your price",
      then: "The order waits on the exchange. You can cancel it any time, and an order that never fills costs nothing.",
    });
  if (a?.kind === "prediction_order" && a.trade !== "sell") {
    const cost = a.maxPrice * a.quantity;
    out.push({
      if: a.combo ? "Any one of them doesn't happen" : p.hedge ? "The thing you're covering doesn't happen" : "It goes the other way",
      then: `It pays nothing and you're out what it cost, at most ${money(cost)}. That is the most this can lose.`,
    });
  }
  if (a?.kind === "spot_order" && a.side === "buy") out.push({ if: "The price falls after you buy", then: "What you bought is worth less. There is no automatic sell." });
  if (a?.kind === "itinerary") out.push({ if: "Traffic or stops take longer", then: "Driving times assume clear roads; allow 10-20% more. Nothing is booked, so nothing is lost." });
  if (paid.length) out.push({ if: "Something is left over", then: "Money set aside for data that wasn't used comes back to you when the job ends." });
  return out;
}
