import type { MoveAction, Proposal } from "@/lib/types";
import { checksText, conditionText } from "./agents/toolbox";
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
  // Same lookup, but it now takes its input from somewhere else (a step it reads from was changed).
  for (const [k, r] of after) {
    const was = before.get(k);
    if (was && JSON.stringify(was.bind ?? {}) !== JSON.stringify(r.bind ?? {})) out.push(`${r.label}: uses the new answer`);
  }

  const pc = checksText(prev) || null;
  const nc = checksText(next) || null;
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
    if ((a.trade ?? "buy") !== (b.trade ?? "buy")) out.push(`${a.trade ?? "buy"} → ${b.trade ?? "buy"}`);
    if (a.quantity !== b.quantity) out.push(`pays $${a.quantity} → $${b.quantity}`);
    if (a.maxPrice !== b.maxPrice) out.push(`${b.trade === "sell" ? "min" : "max"} price ${cents(a.maxPrice)} → ${cents(b.maxPrice)}`);
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

const stepRef = (ref: string) => /^\$([A-Za-z][A-Za-z0-9_-]*)(?:\.|$)/.exec(ref)?.[1];
const readsFrom = (r: Proposal["research"][number]) => [...Object.values(r.bind ?? {}), ...(r.when ? [r.when.ref] : [])].map(stepRef).filter((x): x is string => Boolean(x));

/** The lookups that use what `id` finds, directly or through another lookup, in plan order. */
export function readersOf(research: Proposal["research"], id: string): string[] {
  const found = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of research) if (!found.has(r.id) && readsFrom(r).some((x) => x === id || found.has(x))) (found.add(r.id), (grew = true));
  }
  return research.filter((r) => found.has(r.id)).map((r) => r.id);
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
    if (!except) {
      if (key3(prev.research) !== key3(move.research)) undone.push("the lookups");
      move.research = prev.research;
      return;
    }
    // The edited lookup may change, and so may the lookups that use its answer (they may need to
    // read a different field of it). Every other lookup stays exactly as it was, and each keeps its
    // place, so a step never ends up reading from one that runs after it. Steps are matched by what
    // they look up, since a checked move numbers its steps afresh.
    const free = new Set([except, ...readersOf(prev.research, except)]);
    const used = new Set<string>();
    const toPrev = new Map<string, string>();
    const take = (want: (n: Proposal["research"][number]) => boolean) => {
      const n = move.research.find((x) => !used.has(x.id) && want(x));
      if (n) used.add(n.id);
      return n;
    };
    const prevKeys = new Set(prev.research.map(key));
    const picked = prev.research.map((r) => {
      const n = take((x) => key(x) === key(r)) ?? (r.id === except ? take((x) => !prevKeys.has(key(x))) : undefined);
      if (n) toPrev.set(n.id, r.id);
      return { r, n };
    });
    let otherTouched = move.research.some((x) => !used.has(x.id));
    const relink = (ref: string) => ref.replace(/^\$([A-Za-z][A-Za-z0-9_-]*)/, (all, id: string) => (toPrev.has(id) ? `$${toPrev.get(id)}` : all));
    const out: Proposal["research"] = [];
    for (const { r, n } of picked) {
      if (!free.has(r.id)) {
        if (!n || JSON.stringify(Object.values(n.bind ?? {}).map(relink)) !== JSON.stringify(Object.values(r.bind ?? {}))) otherTouched = true;
        out.push(r);
      } else if (n) {
        const bind = n.bind ? Object.fromEntries(Object.entries(n.bind).map(([f, ref]) => [f, relink(ref)])) : undefined;
        out.push({ ...n, id: r.id, bind, when: n.when ? { ...n.when, ref: relink(n.when.ref) } : undefined });
      }
    }
    if (otherTouched) undone.push("the other lookups");
    move.research = out;
  };
  const keepCondition = () => {
    if (JSON.stringify([prev.condition ?? null, prev.also ?? []]) !== JSON.stringify([move.condition ?? null, move.also ?? []])) undone.push("the check");
    move.condition = prev.condition;
    move.also = prev.also;
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
