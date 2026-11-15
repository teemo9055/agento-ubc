import type { Proposal } from "./types";

/**
 * The shape of a job follows the kind of task, not a fixed recipe.
 * answer: paid lookups, then a write-up. trade: lookups, the order, then watching it fill.
 * check_trade: lookups, a check on fresh data, the order, then watching it. trip: route, then days.
 */
export type Template = "answer" | "trade" | "check_trade" | "trip";

export function templateOf(p: Pick<Proposal, "action" | "condition">): Template {
  if (!p.action) return "answer";
  if (p.action.kind === "itinerary") return "trip";
  return p.condition ? "check_trade" : "trade";
}

export const TEMPLATE_LABEL: Record<Template, string> = {
  answer: "Research, then answer",
  trade: "Trade",
  check_trade: "Check, then trade",
  trip: "Trip plan",
};

/** A resting order on a real exchange gets a step that watches it fill; simulations don't. */
export const watchesOrder = (p: Pick<Proposal, "action" | "venue">) => Boolean(p.action && p.action.kind !== "itinerary" && p.venue !== "paper");
