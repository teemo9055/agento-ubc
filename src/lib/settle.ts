import type { MoveAction, OrderResult, Settlement } from "./types";

type Resolved = "yes" | "no" | undefined;

/**
 * How a bought position ended, from how its contract (or each leg of a combination) resolved.
 * Returns nothing while it is still undecided or when nothing was actually held.
 */
export function settle(action: MoveAction | undefined, order: OrderResult | undefined, resolvedOf: (symbol: string) => Resolved, at = new Date().toISOString()): Settlement | undefined {
  if (!action || action.kind !== "prediction_order" || action.trade === "sell" || !order) return undefined;
  const practice = order.status === "simulated";
  const quantity = practice ? action.quantity : (order.filledQuantity ?? 0);
  if (!(quantity > 0)) return undefined;
  let resolved: Resolved;
  let legs: Settlement["legs"];
  if (action.combo) {
    legs = action.combo.legs.map((l) => ({ label: l.label, side: l.side, resolved: resolvedOf(l.symbol) }));
    // One leg going the wrong way decides it at once; a win needs every leg in.
    if (legs.some((l) => l.resolved && l.resolved !== l.side)) resolved = "no";
    else if (legs.every((l) => l.resolved === l.side)) resolved = "yes";
  } else resolved = resolvedOf(action.symbol);
  if (!resolved) return undefined;
  const won = resolved === action.side;
  const cost = Math.round(quantity * (order.avgPrice ?? action.maxPrice) * 100) / 100;
  return { resolved, won, quantity, paid: won ? quantity : 0, cost, practice, at, legs };
}
