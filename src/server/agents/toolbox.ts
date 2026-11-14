import type { AgentId, Card, Deliverable, MoveAction, MoveCondition, OrderResult, Proposal } from "@/lib/types";
import { SELLERS } from "../sellers";
import { PRODUCTS } from "../x402";
import * as gemini from "../gemini";
import * as geo from "../geo";
import { describeAction, notionalOf, placeOrder, tradingVenue, VENUE_NAME } from "../exchange";
import { RESEARCH } from "../tools";
import type { AgentCtx, AgentDef, EditResult, LineDraft, PhaseDraft, PlanDraft } from "./types";
import { PhaseFailure } from "./types";

/**
 * One agent runtime for every persona. The plan is whatever move was agreed in
 * chat: paid research steps, then a check on fresh data, then the action.
 * Nothing here is a fixed recipe; the steps come from the proposal.
 */

const seller = SELLERS.primary;
const mirror = SELLERS.mirror;
const usd = (x: number) => BigInt(Math.round(x * 1e6)).toString();
export const EXCHANGE_PAYEE = "0x0000000000000000000000000000000000000e0e" as const;

type Opts = { proposal?: Proposal };
type Mem = { data: Record<string, unknown>; check?: CheckResult; order?: OrderResult; days?: Day[]; route?: geo.Route; places?: geo.Place[] };
type Day = { day: number; from: string; to: string; hours: number; km: number };
interface CheckResult {
  met: boolean;
  observed?: number;
  text: string;
  stats: Record<string, unknown>[];
}

function oddsStats(series: gemini.OddsPoint[]) {
  if (series.length === 0) return null;
  const ps = series.map((s) => s.p);
  let jump = 0;
  for (let i = 1; i < ps.length; i++) jump = Math.max(jump, Math.abs(ps[i] - ps[i - 1]));
  const recent = ps.slice(-Math.max(2, Math.floor(ps.length / 4)));
  const momentum = recent[recent.length - 1] - recent[0];
  return { first: ps[0], last: ps[ps.length - 1], change: ps[ps.length - 1] - ps[0], high: Math.max(...ps), low: Math.min(...ps), biggestJump: jump, trend: Math.abs(momentum) < 0.02 ? "flat" : momentum > 0 ? "rising" : "falling" };
}

function spotStats(series: gemini.OddsPoint[]) {
  if (series.length < 2) return null;
  const ps = series.map((x) => x.p);
  const last = ps[ps.length - 1];
  const sma = (n: number) => (ps.length >= n ? ps.slice(-n).reduce((a, b) => a + b, 0) / n : null);
  const s20 = sma(20);
  const s50 = sma(50);
  return { last, change24h: last / ps[Math.max(0, ps.length - 25)] - 1, change7d: last / ps[Math.max(0, ps.length - 169)] - 1, trend: s20 && s50 ? (s20 > s50 * 1.002 ? "up" : s20 < s50 * 0.998 ? "down" : "sideways") : "sideways" };
}

function splitDays(route: geo.Route, places: geo.Place[], hoursPerDay: number): Day[] {
  const days: Day[] = [];
  let cur = { from: places[0].name, hours: 0, km: 0 };
  route.legs.forEach((leg, i) => {
    if (cur.hours > 0 && cur.hours + leg.hours > hoursPerDay) {
      days.push({ day: days.length + 1, from: cur.from, to: places[i].name, hours: cur.hours, km: cur.km });
      cur = { from: places[i].name, hours: 0, km: 0 };
    }
    cur.hours += leg.hours;
    cur.km += leg.distanceKm;
  });
  days.push({ day: days.length + 1, from: cur.from, to: places[places.length - 1].name, hours: cur.hours, km: cur.km });
  return days;
}

async function geocodeAll(names: string[]) {
  const out: geo.Place[] = [];
  for (const n of names) {
    const p = await geo.geocode(n);
    if (!p) throw new PhaseFailure("unknown", `Couldn't find “${n}”`);
    out.push({ ...p, name: n });
  }
  return out;
}

/** Fresh price for the condition, read right before acting. */
async function observe(c: MoveCondition, action?: MoveAction): Promise<number | undefined> {
  if (c.metric === "spot_price") return (await gemini.spotTicker(c.symbol)).last;
  const ticker = action?.kind === "prediction_order" ? action.eventTicker : undefined;
  if (!ticker) return undefined;
  const ev = await gemini.getEvent(ticker);
  const k = ev.contracts.find((x) => x.symbol === c.symbol);
  if (!k) return undefined;
  const yes = k.ask ?? k.last;
  if (yes == null) return undefined;
  return c.metric === "yes_price" ? yes : 1 - (k.bid ?? k.last ?? yes);
}

const fmtVal = (metric: MoveCondition["metric"], v: number) => (metric === "spot_price" ? `$${v.toLocaleString()}` : `${Math.round(v * 100)}¢`);
export const conditionText = (c: MoveCondition) => `${c.metric === "spot_price" ? `${c.symbol.replace(/usd$/, "").toUpperCase()} price` : c.metric === "yes_price" ? "YES price" : "NO price"} ${c.op === "<=" ? "≤" : "≥"} ${fmtVal(c.metric, c.value)}`;

export function planFromProposal(p: Proposal): PlanDraft {
  const lines: LineDraft[] = [];
  const phases: PhaseDraft[] = [];
  for (const r of p.research) {
    const t = RESEARCH[r.tool];
    const price = PRODUCTS[t.product].price;
    lines.push({ id: r.id, phaseId: r.id, purpose: r.label, service: t.product, payeeName: seller.name, payee: seller.address, rail: "x402", approved: price.toString(), calls: { max: 1, unitPrice: price.toString() } });
    phases.push({
      id: r.id,
      label: r.label,
      sub: r.why,
      dependsOn: [],
      optional: true,
      lineId: r.id,
      alternatives: [{ payeeName: mirror.name, payee: mirror.address, service: t.product, price: ((price * mirror.markup) / 100n).toString() }],
    });
  }
  const research = p.research.map((r) => r.id);
  phases.push({ id: "check", label: p.condition ? "Check the condition" : "Read the data", sub: p.condition ? conditionText(p.condition) : "on fresh prices", dependsOn: research, optional: false });
  const a = p.action;
  if (a && a.kind !== "itinerary") {
    const venue = tradingVenue();
    lines.push({ id: "order", phaseId: "act", purpose: describeAction(a), service: a.kind === "prediction_order" ? "prediction order" : "spot order", payeeName: VENUE_NAME[venue], payee: EXCHANGE_PAYEE, rail: "exchange", approved: usd(notionalOf(a)) });
    phases.push({ id: "act", label: a.kind === "prediction_order" ? "Place the order" : "Place the trade", sub: describeAction(a), dependsOn: ["check"], optional: false, lineId: "order" });
  } else if (a?.kind === "itinerary") {
    phases.push({ id: "act", label: "Plan the days", sub: `${a.stops.length} stops · ≤ ${a.hoursPerDay} h a day`, dependsOn: ["check"], optional: false });
  }
  phases.push({ id: "deliver", label: "Report", sub: "what happened and why", dependsOn: [a ? "act" : "check"], optional: false });

  const cards: Card[] = [
    { kind: "deliverable", title: p.title, points: [p.ask, ...(a ? [describeAction(a)] : []), ...p.research.map((r) => r.label)].slice(0, 4) },
    {
      kind: "risk",
      title: a && a.kind !== "itinerary" ? "Limits" : "Read-only",
      points: [
        ...(p.condition ? [`Skips the move unless ${conditionText(p.condition)}`] : []),
        ...(a && a.kind !== "itinerary" ? [`Order capped at $${notionalOf(a).toFixed(2)}`, `${VENUE_NAME[tradingVenue()]}: ${tradingVenue() === "gemini" ? "real money" : "no real money"}`] : ["Nothing is booked or bought"]),
        "Prices can move after the check",
      ].slice(0, 3),
    },
    { kind: "method", title: "Pay per request", points: [p.research.length ? `${p.research.length} paid lookups via x402 on Arc` : "No paid lookups", "Paid from your vault only", a && a.kind !== "itinerary" ? `Order on ${VENUE_NAME[tradingVenue()]}` : "Built-in analysis"] },
  ];
  return { cards, lines, phases };
}

function edit(_card: Card["kind"], prompt: string, o: Record<string, unknown>): EditResult {
  const p = (o as Opts).proposal;
  if (!p) return { ok: false, message: "Agree a move in chat first." };
  const next: Proposal = JSON.parse(JSON.stringify(p));
  const t = prompt.toLowerCase();
  let changed = false;
  const qty = t.match(/(\d+)\s*(contracts?|shares?|x\b)/);
  const cents = t.match(/(\d{1,2})\s*(¢|c\b|cents?)/);
  const dollars = t.match(/\$\s*(\d+(?:\.\d+)?)/);
  const a = next.action;
  if (a?.kind === "prediction_order" && qty) (a.quantity = Math.min(100, Math.max(1, Number(qty[1])))), (changed = true);
  if (a?.kind === "prediction_order" && cents) (a.maxPrice = Math.min(0.99, Math.max(0.01, Number(cents[1]) / 100))), (changed = true);
  if (a?.kind === "spot_order" && dollars) (a.amountUsd = Math.min(100, Math.max(1, Number(dollars[1])))), (changed = true);
  if (/(no|skip|drop|without)\b.*\b(research|lookups?|tape|history|candles)/.test(t) && next.research.length) {
    const kw = /tape/.test(t) ? "trade_tape" : /history/.test(t) ? "odds_history" : /candles/.test(t) ? "spot_candles" : null;
    next.research = next.research.filter((r) => kw && r.tool !== kw);
    changed = true;
  }
  if (/(no|drop|remove|without)\b.*\bcondition/.test(t)) (next.condition = undefined), (changed = true);
  if (!changed) return { ok: false, message: "To change the move itself, ask in the chat.", alternatives: a?.kind === "prediction_order" ? ["5 contracts", "Max 50¢", "Drop the trade tape"] : ["Drop the research"] };
  return { ok: true, message: "Updated", options: { proposal: next } };
}

const TAGLINES: Record<AgentId, { name: string; tagline: string; examples: string[] }> = {
  inso: { name: "Inso", tagline: "Reads the odds, then asks before it bets.", examples: ["Is BTC going to close above 100k this week?", "Which NBA game tonight has the most lopsided odds?", "What do markets think the Fed does next?"] },
  trado: { name: "Trado", tagline: "Spot trends, with a trade only if you say so.", examples: ["Is ETH in an uptrend right now?", "Should I buy SOL on this dip?", "Compare BTC and ETH this week"] },
  travo: { name: "Travo", tagline: "Plans the drive, you take the wheel.", examples: ["Drive from Vancouver to San Francisco in 3 days", "How long is Calgary to Banff?", "Road trip Toronto to Montreal via Ottawa"] },
};

export function toolboxAgent(id: AgentId): AgentDef {
  return {
    id,
    ...TAGLINES[id],
    defaults: {},
    faultPhase: "r1",
    analysisPhase: "check",

    async plan(_task, o) {
      const p = (o as Opts).proposal;
      if (!p) throw new Error("no move agreed yet");
      return planFromProposal(p);
    },

    edit,

    async runPhase(phaseId, ctx: AgentCtx) {
      const p = (ctx.options as Opts).proposal!;
      const mem = ctx.memory as Mem;
      mem.data ??= {};
      const step = p.research.find((r) => r.id === phaseId);
      if (step) {
        const t = RESEARCH[step.tool];
        let params = t.params(step.args);
        if (step.tool === "drive_route") {
          mem.places ??= await geocodeAll(step.args.stops.split("|").map((s) => s.trim()).filter(Boolean));
          params = { stops: JSON.stringify(mem.places) };
        }
        ctx.progress(0.2, step.label);
        mem.data[step.id] = await ctx.buy(step.id, t.product, params, t.key(step.args));
        if (step.tool === "drive_route") mem.route = mem.data[step.id] as geo.Route;
        if (ctx.fault("policy_block")) await ctx.buy("extra", t.product, params, `${t.key(step.args)}:extra`);
        ctx.progress(1);
        return;
      }
      if (phaseId === "check") {
        if (ctx.fault("model_error")) throw new PhaseFailure("model_error", "Analysis crashed mid-run");
        const stats: Record<string, unknown>[] = p.research.map((r) => {
          const d = mem.data[r.id];
          if (r.tool === "odds_history") return { step: r.label, ...oddsStats(d as gemini.OddsPoint[]) };
          if (r.tool === "spot_candles") return { step: r.label, ...spotStats(d as gemini.OddsPoint[]) };
          if (r.tool === "trade_tape") {
            const ts = (d as { size: number; side: string }[]) ?? [];
            return { step: r.label, trades: ts.length, buys: ts.filter((x) => x.side === "buy").reduce((s, x) => s + x.size, 0), sells: ts.filter((x) => x.side === "sell").reduce((s, x) => s + x.size, 0) };
          }
          const rt = d as geo.Route | undefined;
          return { step: r.label, km: rt ? Math.round(rt.distanceKm) : null, hours: rt ? Number(rt.hours.toFixed(1)) : null };
        });
        if (!p.condition) {
          mem.check = { met: true, text: "No condition: proceeding", stats };
        } else {
          const v = await observe(p.condition, p.action).catch(() => undefined);
          const met = v != null && (p.condition.op === "<=" ? v <= p.condition.value : v >= p.condition.value);
          mem.check = { met, observed: v, stats, text: v == null ? "Couldn't read a fresh price, so the move is skipped" : `${conditionText(p.condition)} → now ${fmtVal(p.condition.metric, v)} · ${met ? "met" : "not met"}` };
        }
        ctx.progress(1, mem.check.text);
        return;
      }
      if (phaseId === "act") {
        const a = p.action!;
        if (a.kind === "itinerary") {
          mem.places ??= await geocodeAll(a.stops);
          mem.route ??= await geo.drive(mem.places);
          mem.days = splitDays(mem.route, mem.places, a.hoursPerDay);
          ctx.progress(1, `${mem.days.length} days`);
          return;
        }
        if (!mem.check?.met) {
          mem.order = { venue: tradingVenue(), status: "skipped", detail: `Not placed: ${mem.check?.text ?? "condition not met"}`, notional: 0 };
          ctx.order?.(mem.order);
          ctx.progress(1, "Skipped: condition not met");
          return;
        }
        ctx.progress(0.3, "Sending order");
        mem.order = await placeOrder(a);
        ctx.order?.(mem.order);
        if (mem.order.status === "rejected") throw new PhaseFailure("unknown", `Exchange rejected the order: ${mem.order.detail}`);
        ctx.progress(1, mem.order.status === "filled" ? "Filled" : "Order placed");
        return;
      }
      ctx.progress(1);
    },

    deliver(ctx): Deliverable {
      const p = (ctx.options as Opts).proposal!;
      const mem = ctx.memory as Mem;
      const o = mem.order;
      const summary = o
        ? o.status === "skipped"
          ? `Held off: ${mem.check?.text ?? "condition not met"}`
          : `${o.status === "filled" ? "Filled" : "Placed"} on ${VENUE_NAME[o.venue]}: ${o.detail}`
        : mem.days
          ? `${mem.days.length} driving days · ${Math.round(mem.route?.distanceKm ?? 0)} km`
          : (mem.check?.text ?? p.title);
      return {
        summary,
        method: `${p.research.length} paid lookups via x402 on Arc${o ? ` · ${VENUE_NAME[o.venue]}` : ""}`,
        data: { move: p, check: mem.check, order: o, days: mem.days, places: mem.places, route: mem.route },
      };
    },
  };
}
