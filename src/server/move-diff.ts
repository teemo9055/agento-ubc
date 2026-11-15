import type { MoveAction, Proposal } from "@/lib/types";
import { conditionText } from "./agents/toolbox";
import { describeAction } from "./exchange";

/**
 * What changed between two versions of a move, in plain words, and a guard so an edit
 * only touches the part the user asked about.
 */

const cents = (x: number) => `${Math.round(x * 100)}¢`;
const key = (r: Proposal["research"][number]) => `${r.tool}:${JSON.stringify(Object.entries(r.args).map(([k, v]) => [k, String(v).toLowerCase()]).sort())}`;

export function diffMoves(prev: Proposal, next: Proposal): string[] {
  const out: string[] = [];
  const before = new Map(prev.research.map((r) => [key(r), r]));
  const after = new Map(next.research.map((r) => [key(r), r]));
  for (const [k, r] of after) if (!before.has(k)) out.push(`+ ${r.label}`);
  for (const [k, r] of before) if (!after.has(k)) out.push(`− ${r.label}`);

  const pc = prev.condition ? conditionText(prev.condition) : null;
  const nc = next.condition ? conditionText(next.condition) : null;
  if (pc !== nc) out.push(!nc ? `− check (${pc})` : !pc ? `+ check: ${nc}` : `check: ${pc} → ${nc}`);

  const a = prev.action;
  const b = next.action;
  if (!a && b) out.push(`+ ${describeAction(b)}`);
  else if (a && !b) out.push(`− ${describeAction(a)}`);
  else if (a && b) out.push(...actionChanges(a, b));
  if ((prev.budgetUsd ?? null) !== (next.budgetUsd ?? null) && next.budgetUsd != null) out.push(`budget $${next.budgetUsd}`);
  return out;
}

function actionChanges(a: MoveAction, b: MoveAction): string[] {
  if (a.kind !== b.kind) return [`${describeAction(a)} → ${describeAction(b)}`];
  const out: string[] = [];
  if (a.kind === "prediction_order" && b.kind === "prediction_order") {
    if (a.symbol !== b.symbol) out.push(`contract: ${a.label} → ${b.label}`);
    if (a.side !== b.side) out.push(`side: ${a.side.toUpperCase()} → ${b.side.toUpperCase()}`);
    if (a.quantity !== b.quantity) out.push(`${a.quantity} → ${b.quantity} contracts`);
    if (a.maxPrice !== b.maxPrice) out.push(`max price ${cents(a.maxPrice)} → ${cents(b.maxPrice)}`);
    if (a.orderType !== b.orderType) out.push(`${a.orderType} → ${b.orderType}`);
    if ((a.stopPrice ?? null) !== (b.stopPrice ?? null) && b.stopPrice != null) out.push(`trigger ${cents(b.stopPrice)}`);
  } else if (a.kind === "spot_order" && b.kind === "spot_order") {
    if (a.symbol !== b.symbol) out.push(`coin: ${a.symbol.toUpperCase()} → ${b.symbol.toUpperCase()}`);
    if (a.side !== b.side) out.push(`${a.side} → ${b.side}`);
    if (a.amountUsd !== b.amountUsd) out.push(`$${a.amountUsd} → $${b.amountUsd}`);
    if (a.limitPrice !== b.limitPrice) out.push(`limit $${a.limitPrice} → $${b.limitPrice}`);
  } else if (a.kind === "itinerary" && b.kind === "itinerary") {
    if (a.stops.join("|") !== b.stops.join("|")) out.push(`stops: ${b.stops.join(" → ")}`);
    if (a.hoursPerDay !== b.hoursPerDay) out.push(`${a.hoursPerDay} → ${b.hoursPerDay} h a day`);
  }
  return out;
}

/**
 * Keeps an edit inside its scope. Editing the order can't swap the market or the lookups;
 * editing a lookup can't change the order; editing the check only touches the check.
 * Out-of-scope changes are undone and reported, never applied silently.
 */
export function guardEdit(prev: Proposal, next: Proposal, step?: string): { move: Proposal; undone: string[] } {
  if (!step || step === "method") return { move: next, undone: [] };
  const move: Proposal = JSON.parse(JSON.stringify(next));
  const undone: string[] = [];
  const keepAction = () => {
    if (JSON.stringify(prev.action) !== JSON.stringify(move.action)) undone.push("the order");
    move.action = prev.action;
    move.budgetUsd = prev.budgetUsd;
  };
  const keepResearch = (except?: string) => {
    const want = except ? move.research : prev.research;
    if (!except && key3(prev.research) !== key3(move.research)) undone.push("the lookups");
    if (except) {
      // Only the edited lookup may change; every other lookup stays as it was.
      const others = prev.research.filter((r) => r.id !== except);
      const kept = want.filter((r) => !others.some((o) => key(o) === key(r)));
      move.research = [...others, ...kept.slice(0, 1)];
    } else move.research = prev.research;
  };
  const keepCondition = () => {
    if (JSON.stringify(prev.condition ?? null) !== JSON.stringify(move.condition ?? null)) undone.push("the check");
    move.condition = prev.condition;
  };
  const keepMarket = () => {
    const a = prev.action;
    const b = move.action;
    if (a && b && a.kind === b.kind && "symbol" in a && "symbol" in b && a.symbol !== b.symbol) {
      undone.push("the market");
      move.action = { ...b, ...(a.kind === "prediction_order" ? { symbol: a.symbol, eventTicker: a.eventTicker, label: a.label } : { symbol: a.symbol }) } as MoveAction;
    }
    if (a && b && a.kind !== b.kind) {
      undone.push("the kind of order");
      move.action = a;
    }
  };
  if (step === "act") {
    keepResearch();
    keepCondition();
    keepMarket();
  } else if (step === "check") {
    keepAction();
    keepResearch();
  } else {
    keepAction();
    keepCondition();
    keepResearch(step);
  }
  return { move, undone };
}

const key3 = (rs: Proposal["research"]) => rs.map(key).sort().join(",");
