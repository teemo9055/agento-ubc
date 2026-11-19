import type { AgentId, Card, Deliverable, MoveAction, MoveCondition, OrderResult, Proposal, Run } from "@/lib/types";
import { stepName } from "@/lib/plain";
import { VENDOR_PROMISES } from "../delivery";
import { SELLERS } from "../sellers";
import { PRODUCTS } from "../x402";
import * as gemini from "../gemini";
import * as geo from "../geo";
import { describeAction, ExchangeError, marketBase, notionalOf, placeOrder, refreshOrder, VENUE_NAME, VENUE_NOTE } from "../exchange";
import { templateOf, watchesOrder } from "@/lib/templates";
import { doesLine } from "@/lib/plain";

/** How long the job itself follows a resting order before handing it to the background tracker. */
const WATCH_MINUTES = Number(process.env.WATCH_MINUTES ?? 5);
const WATCH_POLL_MS = Number(process.env.WATCH_POLL_MS ?? 15_000);
import { RESEARCH } from "../tools";
import { isVendorTool, VENDOR_TOOLS } from "../vendor-tools";
import { chainlinkPrice, type OraclePrice } from "../chainlink";
import type { AgentCtx, AgentDef, EditResult, LineDraft, PhaseDraft, PlanDraft } from "./types";
import { PhaseFailure } from "./types";

/**
 * One agent runtime for every persona. The plan is whatever move was agreed in
 * chat: paid research steps, then a check on fresh data, then the action.
 * Nothing here is a fixed recipe; the steps come from the proposal.
 */

const seller = SELLERS.primary;
const usd = (x: number) => BigInt(Math.round(x * 1e6)).toString();
export const EXCHANGE_PAYEE = "0x0000000000000000000000000000000000000e0e" as const;
/** Quicknode's payTo for x402 on the Agent Marketplace (from its listing). */
export { QUICKNODE_PAYEE } from "../vendor-tools";

type Opts = { proposal?: Proposal };
type Mem = { orderSince?: number; data: Record<string, unknown>; check?: CheckResult; order?: OrderResult; days?: Day[]; route?: geo.Route; places?: geo.Place[] };
type Day = { day: number; from: string; to: string; hours: number; km: number; /** Places to sleep where the day ends: a shortlist from the map, not a booking. */ stay?: { name: string; where: string; website?: string }[] };
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

/**
 * Fresh price for the condition, read right before acting. The book the order trades on comes first;
 * Gemini's test exchange often has an empty book, so then the live market's price is used and named.
 */
async function observe(c: MoveCondition, action: MoveAction | undefined, venue: Proposal["venue"]): Promise<{ value: number; source: string } | undefined> {
  if (c.metric === "spot_price") return { value: (await gemini.spotTicker(c.symbol)).last, source: "Gemini spot" };
  // A check on one leg of a combination reads that leg's own market.
  const ticker = action?.kind === "prediction_order" ? (action.combo?.legs.find((l) => l.symbol === c.symbol)?.eventTicker ?? action.eventTicker) : undefined;
  if (!ticker) return undefined;
  const read = async (base: string) => {
    const ev = await gemini.getEvent(ticker, base).catch(() => null);
    const k = ev?.contracts.find((x) => x.symbol === c.symbol);
    if (!k) return undefined;
    const yes = k.ask ?? k.last;
    if (yes == null) return undefined;
    return c.metric === "yes_price" ? yes : 1 - (k.bid ?? k.last ?? yes);
  };
  const own = await read(marketBase(venue));
  if (own != null) return { value: own, source: venue === "gemini-sandbox" ? "test exchange" : "Gemini" };
  if (venue !== "gemini-sandbox") return undefined;
  const live = await read(gemini.PROD_BASE);
  return live != null ? { value: live, source: "live market (test exchange book empty)" } : undefined;
}

const dollars = (m: MoveCondition["metric"]) => m === "spot_price" || m === "oracle_price";
const fmtVal = (metric: MoveCondition["metric"], v: number) => (dollars(metric) ? `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : `${Math.round(v * 100)}¢`);
const coin = (s: string) => s.replace(/usd$/, "").toUpperCase();
/** Every check a move carries: the main one and any that must hold with it. */
export const checksOf = (p: Pick<Proposal, "condition" | "also">): MoveCondition[] => (p.condition ? [p.condition, ...(p.also ?? [])] : []);
export const checksText = (p: Pick<Proposal, "condition" | "also">) => checksOf(p).map(conditionText).join(" and ");
export const conditionText = (c: MoveCondition) =>
  `${c.metric === "oracle_price" ? `Chainlink ${coin(c.symbol)}` : c.metric === "spot_price" ? `${coin(c.symbol)} price` : c.metric === "yes_price" ? "YES price" : "NO price"} ${c.op === "<=" ? "≤" : "≥"} ${fmtVal(c.metric, c.value)}`;

export function planFromProposal(p: Proposal): PlanDraft {
  const lines: LineDraft[] = [];
  const phases: PhaseDraft[] = [];
  for (const r of p.research) {
    const t = RESEARCH[r.tool];
    if (isVendorTool(r.tool)) {
      const v = VENDOR_TOOLS[r.tool];
      const price = v.price(r.args);
      lines.push({ id: r.id, phaseId: r.id, purpose: stepName(r), service: v.service(r.args), payeeName: v.payeeName(r.args), payee: v.payee(r.args), rail: "gateway", approved: price.toString(), calls: { max: 1, unitPrice: price.toString() } });
      phases.push({ id: r.id, label: stepName(r), sub: r.why, dependsOn: [], optional: true, lineId: r.id });
      continue;
    }
    const price = PRODUCTS[t.product].price;
    lines.push({ id: r.id, phaseId: r.id, purpose: stepName(r), service: t.product, payeeName: seller.name, payee: seller.address, rail: "x402", approved: price.toString(), calls: { max: 1, unitPrice: price.toString() } });
    phases.push({
      id: r.id,
      label: stepName(r),
      sub: r.why,
      dependsOn: [],
      optional: true,
      lineId: r.id
    });
  }
  const research = p.research.map((r) => r.id);
  const a = p.action;
  const template = templateOf(p);
  // The boxes follow the kind of task: no fixed check or report step when it adds nothing.
  if (template === "answer") phases.push({ id: "check", label: "Write it up", sub: "what the data says", dependsOn: research, optional: false });
  if (template === "check_trade") phases.push({ id: "check", label: checksOf(p).length > 1 ? "Check the conditions" : "Check the condition", sub: checksText(p), dependsOn: research, optional: false });
  const before = template === "check_trade" ? ["check"] : research;
  if (a && a.kind !== "itinerary") {
    const venue = p.venue;
    lines.push({ id: "order", phaseId: "act", purpose: describeAction(a), service: a.kind === "prediction_order" ? "prediction order" : "spot order", payeeName: VENUE_NAME[venue], payee: EXCHANGE_PAYEE, rail: "exchange", approved: usd(notionalOf(a)) });
    phases.push({ id: "act", label: a.kind === "prediction_order" ? (a.trade === "sell" ? "Place the sell" : "Place the order") : "Place the trade", sub: `${doesLine(a).label} · ${doesLine(a).detail}`, dependsOn: before, optional: false, lineId: "order" });
    if (watchesOrder(p)) phases.push({ id: "watch", label: "Watch until filled", sub: `up to ${WATCH_MINUTES} min, then tracked in the background`, dependsOn: ["act"], optional: false });
  } else if (a?.kind === "itinerary") {
    phases.push({ id: "act", label: "Plan the days", sub: `${a.stops.length} stops · ≤ ${a.hoursPerDay} h a day`, dependsOn: before, optional: false });
  }
  // Bookings you make yourself come last: the link is ready once everything before it is done.
  const last = phases.some((x) => x.id === "act") ? ["act"] : phases.some((x) => x.id === "check") ? ["check"] : research;
  (p.finish ?? []).forEach((h, i) =>
    phases.push({ id: `h${i + 1}`, label: h.label, sub: `You finish it in ${h.app}`, dependsOn: last, optional: true, finish: { app: h.app, url: h.url } }),
  );

  const cards: Card[] = [
    { kind: "deliverable", title: p.title, points: [p.ask, ...(a ? [describeAction(a)] : []), ...p.research.map((r) => r.label)].slice(0, 4) },
    {
      kind: "risk",
      title: a && a.kind !== "itinerary" ? "Limits" : "Read-only",
      points: [
        ...(p.condition ? [`Skips the move unless ${checksText(p)}`] : []),
        ...(a && a.kind !== "itinerary" ? [`Order capped at $${notionalOf(a).toFixed(2)}`, VENUE_NOTE[p.venue]] : ["Nothing is booked or bought"]),
        "Prices can move after the check",
      ].slice(0, 3),
    },
    { kind: "method", title: "Pay per request", points: [p.research.length ? `${p.research.length} paid lookup${p.research.length === 1 ? "" : "s"}${p.research.some((r) => r.tool === "oracle_price") ? " incl. Circle Agent Marketplace" : " via x402 on Arc"}` : "No paid lookups", "Paid from your vault only", a && a.kind !== "itinerary" ? (p.venue === "paper" ? "Order simulated, not sent" : `Order on ${VENUE_NAME[p.venue]}`) : "Built-in analysis"] },
  ];
  return { cards, lines, phases };
}

const DROP = /\b(drop|remove|skip|delete|without|don'?t|no need)\b/;
const TF: Record<string, [RegExp, string][]> = {
  odds_history: [
    [/\b5\s*-?\s*m(in(ute)?s?)?\b/, "5m"],
    [/\b15\s*-?\s*m(in(ute)?s?)?\b/, "15m"],
    [/\b(1\s*h(ou)?r?|hourly|hour)\b/, "1hr"],
  ],
  spot_candles: [
    [/\b(1\s*h(ou)?r?|hourly|hour)\b/, "1hr"],
    [/\b(1\s*d(ay)?|daily|day)\b/, "1day"],
  ],
};
const TF_LABEL: Record<string, string> = { "5m": "5-minute", "15m": "15-minute", "1hr": "hourly", "1day": "daily" };

/** An edit aimed at one step of the graph: a paid lookup (r1, r2…), the condition check, or the move itself. */
function editStep(next: Proposal, step: string, t: string): EditResult {
  const a = next.action;
  const r = next.research.find((x) => x.id === step);
  if (r) {
    if (r.tool === "drive_route") {
      const stops = r.args.stops.split("|").map((s) => s.trim()).filter(Boolean);
      const add = t.match(/\b(?:add|via|stop (?:at|in))\s+([a-z .'-]{2,40})/i);
      const del = t.match(/\b(?:remove|drop|skip)\s+([a-z .'-]{2,40})/i);
      const delIdx = del ? stops.findIndex((s) => s.toLowerCase() === del[1].trim().toLowerCase()) : -1;
      if (add) {
        const place = add[1].trim().replace(/\b\w/g, (c) => c.toUpperCase());
        stops.splice(Math.max(1, stops.length - 1), 0, place);
      } else if (delIdx > 0 && delIdx < stops.length - 1) {
        stops.splice(delIdx, 1);
      }
      if (add || (delIdx > 0 && delIdx < stops.length)) {
        r.args.stops = stops.join("|");
        if (a?.kind === "itinerary") a.stops = stops;
        return { ok: true, message: `Route: ${stops.join(" → ")}`, options: { proposal: next } };
      }
    }
    if (DROP.test(t)) {
      next.research = next.research.filter((x) => x.id !== step);
      return { ok: true, message: `Dropped “${r.label}”`, options: { proposal: next } };
    }
    if (r.tool === "drive_route") return { ok: false, message: "For the route, add or remove a stop.", alternatives: ["Add Kamloops", "Drop this step"] };
    const tf = TF[r.tool]?.find(([re]) => re.test(t))?.[1];
    if (tf) {
      r.args.tf = tf;
      return { ok: true, message: `“${r.label}” now uses ${TF_LABEL[tf]} data`, options: { proposal: next } };
    }
    const opts = TF[r.tool]?.filter(([, v]) => v !== r.args.tf).map(([, v]) => `Use ${TF_LABEL[v]} data`) ?? [];
    return { ok: false, message: "This step buys one piece of data. You can drop it or change its timeframe.", alternatives: [...opts.slice(0, 2), "Drop this step"] };
  }

  if (step === "check") {
    const c = next.condition;
    if (!c) return { ok: false, message: "There is no condition to change. To add one, ask in the chat." };
    if (DROP.test(t)) {
      next.condition = undefined;
      next.also = undefined;
      return { ok: true, message: "Dropped the check: the move goes ahead once the data is read", options: { proposal: next } };
    }
    const op = /\b(above|over|at least|higher|more than)\b|>/.test(t) ? ">=" : /\b(below|under|at most|lower|less than)\b|</.test(t) ? "<=" : c.op;
    const spot = c.metric === "spot_price" || c.metric === "oracle_price";
    const num = spot ? t.match(/\$?\s*(\d[\d,]*(?:\.\d+)?)/) : t.match(/(\d{1,2})\s*(?:¢|c\b|cents?|%)?/);
    if (num || op !== c.op) {
      if (num) c.value = spot ? Number(num[1].replace(/,/g, "")) : Math.min(0.99, Math.max(0.01, Number(num[1]) / 100));
      c.op = op;
      return { ok: true, message: `Only acts if ${conditionText(c)}`, options: { proposal: next } };
    }
    return {
      ok: false,
      message: "Say the new threshold, or drop the check.",
      alternatives: spot ? [`Only if below $${Math.round(c.value * 0.98).toLocaleString("en-US")}`, "Drop the check"] : [`Only if below ${Math.round(c.value * 100) - 3}¢`, "Drop the check"],
    };
  }

  if (step === "act") {
    if (a?.kind === "itinerary") {
      const h = t.match(/(\d{1,2})\s*(h|hours?)\b/);
      if (h) {
        a.hoursPerDay = Math.min(12, Math.max(1, Number(h[1])));
        return { ok: true, message: `At most ${a.hoursPerDay} h of driving a day`, options: { proposal: next } };
      }
      return { ok: false, message: "Say how many hours of driving a day.", alternatives: ["4 hours a day", "6 hours a day"] };
    }
    if (a && /\b(drop|remove|skip|no|don'?t)\b.*\b(order|trade|buy|sell)\b/.test(t)) {
      next.action = undefined;
      next.condition = undefined;
      next.also = undefined;
      return { ok: true, message: "No order: the job only reads the data and reports", options: { proposal: next } };
    }
    return { ok: false, message: "Say the new size or price limit.", alternatives: a?.kind === "prediction_order" ? ["5 contracts", "Max 50¢", "Don't place the order"] : ["$5", "Don't place the trade"] };
  }
  return { ok: false, message: "This step has nothing to change on its own." };
}

function edit(_card: Card["kind"], prompt: string, o: Record<string, unknown>, step?: string): EditResult {
  const p = (o as Opts).proposal;
  if (!p) return { ok: false, message: "Agree a move in chat first." };
  const next: Proposal = JSON.parse(JSON.stringify(p));
  const t = prompt.toLowerCase();
  if (step && step !== "act") return editStep(next, step, t);
  let changed = false;
  const qty = t.match(/(\d+)\s*(contracts?|shares?|x\b)/);
  const cents = t.match(/(\d{1,2})\s*(¢|c\b|cents?)/);
  const dollars = t.match(/\$\s*(\d+(?:\.\d+)?)/) ?? t.match(/(\d+(?:\.\d+)?)\s*(?:dollars?|bucks|usd|usdc)\b/);
  const a = next.action;
  if (a?.kind === "prediction_order" && qty) (a.quantity = Math.min(100, Math.max(1, Number(qty[1])))), (changed = true);
  if (a?.kind === "prediction_order" && cents) (a.maxPrice = Math.min(0.99, Math.max(0.01, Number(cents[1]) / 100))), (changed = true);
  if (a?.kind === "spot_order" && dollars) (a.amountUsd = Math.min(100, Math.max(1, Number(dollars[1])))), (changed = true);
  if (/(no|skip|drop|without)\b.*\b(research|lookups?|tape|trades|history|odds|candles|chart)/.test(t) && next.research.length) {
    const kw = /tape|trades/.test(t) ? "trade_tape" : /history|odds/.test(t) ? "odds_history" : /candles|chart/.test(t) ? "spot_candles" : null;
    next.research = next.research.filter((r) => kw && r.tool !== kw);
    changed = true;
  }
  if (/(no|drop|remove|without)\b.*\bcondition/.test(t)) (next.condition = undefined), (changed = true);
  if (!changed && step === "act") return editStep(next, step, t);
  if (!changed) return { ok: false, message: "To change the move itself, ask in the chat.", alternatives: a?.kind === "prediction_order" ? ["5 contracts", "Max 50¢", "Skip recent trades"] : ["Skip the paid lookups"] };
  const what = [
    JSON.stringify(a) !== JSON.stringify(p.action) && a ? `Order: ${describeAction(a)}` : "",
    next.research.length !== p.research.length ? `${p.research.length - next.research.length} paid lookup${p.research.length - next.research.length === 1 ? "" : "s"} dropped` : "",
    !next.condition && p.condition ? "Check dropped" : "",
  ].filter(Boolean);
  return { ok: true, message: what.join(" · ") || "Updated", options: { proposal: next } };
}

const TAGLINES: Record<AgentId, { name: string; tagline: string; examples: string[] }> = {
  inso: {
    name: "Inso",
    tagline: "Reads prediction-market odds and asks before it places an order.",
    examples: [
      "I hold BTC. Cover me for $30 if it drops below $60k this month",
      "Put $5 on BTC above $65k, but only if Chainlink agrees",
      "A cold snap would cost me $20 in rides tomorrow in NYC. Can I hedge that?",
      "What does the market think the Fed does next?",
      "Sell my calmest position",
    ],
  },
  trado: {
    name: "Trado",
    tagline: "Spots price trends and trades only when you approve.",
    examples: [
      "Is ETH in an uptrend? Buy $10 only if it is",
      "Buy $20 of SOL if it dips 2% from here",
      "Check BTC against Chainlink, then buy $10 if they agree",
      "BTC or ETH: which looks stronger this week?",
    ],
  },
  worko: {
    name: "Worko",
    tagline: "Gets real-world things done: checks before you commit, drives planned, bookings ready.",
    examples: [
      "Is this Marketplace listing real? The seller's number is 604-555-0199",
      "Vancouver to San Francisco in 3 days: where should I sleep?",
      "Get me from SEA airport to my hotel downtown when I land",
      "Toronto to Montreal via Ottawa, max 4 hours of driving a day",
    ],
  },
};

export function toolboxAgent(id: AgentId): AgentDef {
  return {
    id,
    ...TAGLINES[id],
    defaults: {},
    faultPhase: "r1",

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
      if (step && isVendorTool(step.tool)) {
        const v = VENDOR_TOOLS[step.tool];
        const t = RESEARCH[step.tool];
        ctx.progress(0.2, step.label);
        const got = await ctx.buyMarketplace!(step.id, t.key(step.args), t.product, () => v.run(step.args, v.price(step.args)), {
          promise: VENDOR_PROMISES[step.tool],
          asked: { ...(step.args.symbol ? { symbol: step.args.symbol } : {}), ...(step.args.address ? { address: step.args.address } : {}) },
        });
        mem.data[step.id] = got;
        ctx.progress(1, v.note(got));
        return;
      }
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
      if (/^h\d$/.test(phaseId)) {
        // Nothing to pay or call: the link was built when the move was checked.
        ctx.progress(1, "Link ready for you");
        return;
      }
      if (phaseId === "check") {
        await analyse(p, mem, ctx);
        ctx.progress(1, mem.check!.text);
        return;
      }
      if (phaseId === "watch") {
        await watch(mem, ctx, a0(p));
        return;
      }
      if (phaseId === "act") {
        const a = p.action!;
        if (a.kind !== "itinerary" && !mem.check) await analyse(p, mem, ctx);
        if (a.kind === "itinerary") {
          mem.places ??= await geocodeAll(a.stops);
          mem.route ??= await geo.drive(mem.places);
          mem.days = splitDays(mem.route, mem.places, a.hoursPerDay);
          // Where each driving day ends, list a few places to sleep. One at a time: the map service asks for that.
          let stays = 0;
          for (const d of mem.days) {
            const at = mem.places.find((x) => x.name === d.to);
            if (!at) continue;
            ctx.progress(0.6, `Looking for places to stay in ${d.to}`);
            // A shortlist is a nice-to-have: if the map service is slow or down, the plan still stands.
            const found = await Promise.resolve()
              .then(() => geo.nearby(at, "hotel", 3))
              .catch(() => []);
            if (found.length) {
              d.stay = found.map((x) => ({ name: x.name, where: x.where, website: x.website }));
              stays++;
            }
          }
          ctx.progress(1, `${mem.days.length} day${mem.days.length === 1 ? "" : "s"}${stays ? ` · places to stay listed for ${stays === mem.days.length ? "each night" : `${stays} of them`}` : ""}`);
          return;
        }
        if (!mem.check?.met) {
          mem.order = { venue: p.venue, status: "skipped", detail: `Not placed: ${mem.check?.text ?? "condition not met"}`, notional: 0 };
          ctx.order?.(mem.order);
          ctx.progress(1, "Skipped: condition not met");
          return;
        }
        ctx.progress(0.3, "Sending order");
        try {
          // Same timestamp on every retry, so a retry finds the first attempt instead of ordering twice.
          mem.orderSince ??= Date.now();
          mem.order = await placeOrder(a, mem.orderSince);
        } catch (e) {
          const err = e as ExchangeError;
          ctx.order?.({ venue: p.venue, status: "rejected", detail: err.message, notional: 0 });
          // Retryable: the user can accept terms or fund the account, then retry.
          throw new PhaseFailure("exchange_rejected", `${VENUE_NAME[p.venue]}: ${err.message}`);
        }
        ctx.order?.(mem.order);
        ctx.progress(1, mem.order.status === "filled" ? "Filled" : mem.order.status === "simulated" ? "Simulated, not sent" : "Order resting on the exchange");
        return;
      }
      ctx.progress(1);
    },
    deliver: deliverFor,
    restore: restoreMemory,
  };
}

const a0 = (p: Proposal) => p.action!;

/** Working memory from a saved job: bought data from the feed, the order if one was placed. */
function restoreMemory(options: Record<string, unknown>, run: Run): Record<string, unknown> {
  const p = (options as Opts).proposal;
  const mem: Mem = { data: {} };
  if (!p) return mem as unknown as Record<string, unknown>;
  const done = new Set(run.phases.filter((x) => x.status === "done").map((x) => x.id));
  for (const r of p.research) {
    if (!done.has(r.id)) continue;
    const k = r.tool === "oracle_price" ? `oracle:${r.args.symbol.toLowerCase()}` : RESEARCH[r.tool].key(r.args);
    const hit = run.feed?.[k];
    if (hit) mem.data[r.id] = hit.data;
    if (r.tool === "drive_route" && hit) mem.route = hit.data as geo.Route;
  }
  if (run.order && run.order.status !== "rejected") mem.order = run.order;
  // Any matching order placed after approval is ours: a retry after a restart finds it instead of ordering twice.
  if (run.startedAt) mem.orderSince = Date.parse(run.startedAt);
  return mem as unknown as Record<string, unknown>;
}

/** Reads what the paid lookups returned and evaluates the condition. Used by the check step, or by the order step when there's none. */
async function analyse(p: Proposal, mem: Mem, ctx: AgentCtx) {
  if (ctx.fault("model_error")) throw new PhaseFailure("model_error", "Analysis crashed mid-run");
  const stats: Record<string, unknown>[] = p.research.map((r) => {
    const d = mem.data[r.id];
    if (r.tool === "odds_history") return { step: r.label, ...oddsStats(d as gemini.OddsPoint[]) };
    if (r.tool === "spot_candles") return { step: r.label, ...spotStats(d as gemini.OddsPoint[]) };
    if (isVendorTool(r.tool)) return { step: r.label, ...(d ? VENDOR_TOOLS[r.tool].stat(d) : {}) };
    if (r.tool === "trade_tape") {
      const ts = (d as { size: number; side: string }[]) ?? [];
      return { step: r.label, trades: ts.length, buys: ts.filter((x) => x.side === "buy").reduce((s, x) => s + x.size, 0), sells: ts.filter((x) => x.side === "sell").reduce((s, x) => s + x.size, 0) };
    }
    const rt = d as geo.Route | undefined;
    return { step: r.label, km: rt ? Math.round(rt.distanceKm) : null, hours: rt ? Number(rt.hours.toFixed(1)) : null };
  });
  if (!p.condition) {
    mem.check = { met: true, text: p.action ? "No condition: going ahead" : "Data read", stats };
  } else {
    // All checks are read at the same moment; the move goes ahead only if every one passes.
    const read = await Promise.all(
      checksOf(p).map(async (c) => {
        const bought = p.research.find((r) => r.tool === "oracle_price" && r.args.symbol.toLowerCase() === c.symbol);
        const seen = c.metric === "oracle_price" ? { value: (mem.data[bought?.id ?? ""] as OraclePrice | undefined)?.price, source: "Chainlink" } : await observe(c, p.action, p.venue).catch(() => undefined);
        const v = seen?.value;
        const met = v != null && (c.op === "<=" ? v <= c.value : v >= c.value);
        return { met, v, text: v == null ? `${conditionText(c)} → couldn't read a fresh price` : `${conditionText(c)} → now ${fmtVal(c.metric, v)} (${seen?.source}) · ${met ? "met" : "not met"}` };
      }),
    );
    const met = read.every((r) => r.met);
    const unread = read.length === 1 && read[0].v == null;
    mem.check = { met, observed: read[0].v, stats, text: unread ? "Couldn't read a fresh price, so the move is skipped" : read.map((r) => r.text).join("; ") };
  }
}

/** Follows a resting order on the exchange for a few minutes; after that the background tracker keeps it current. */
async function watch(mem: Mem, ctx: AgentCtx, action: MoveAction) {
  const o = mem.order;
  if (!o || o.status !== "open") {
    ctx.progress(1, o ? (o.status === "filled" ? "Filled" : o.status === "skipped" ? "Nothing to watch: order not placed" : `Order ${o.status}`) : "No order");
    return;
  }
  const until = Date.now() + WATCH_MINUTES * 60_000;
  let cur = o;
  while (Date.now() < until && cur.status === "open") {
    await new Promise((r) => setTimeout(r, WATCH_POLL_MS));
    const next = await refreshOrder(cur, action.kind).catch(() => cur);
    if (JSON.stringify(next) !== JSON.stringify(cur)) ctx.order?.(next);
    cur = next;
    mem.order = cur;
    const left = Math.max(0, Math.round((until - Date.now()) / 60_000));
    ctx.progress(Math.min(0.95, 1 - (until - Date.now()) / (WATCH_MINUTES * 60_000)), cur.status === "open" ? `Filled ${cur.filledQuantity ?? 0} of ${cur.quantity ?? "?"} · ${left} min left` : `Order ${cur.status}`);
  }
  ctx.progress(1, cur.status === "filled" ? "Filled" : cur.status === "open" ? "Still resting; tracked in the background" : `Order ${cur.status}`);
}

function deliverFor(ctx: AgentCtx): Deliverable {
const p = (ctx.options as Opts).proposal!;
const mem = ctx.memory as Mem;
const o = mem.order;
const summary = o
  ? o.status === "skipped"
    ? `Held off: ${mem.check?.text ?? "condition not met"}`
    : o.status === "simulated"
      ? `Simulated (no exchange connected): ${o.detail}`
      : `${o.status === "filled" ? "Filled" : "Order open"} on ${VENUE_NAME[o.venue]}: ${o.detail}`
  : mem.days
    ? `${mem.days.length} driving days · ${Math.round(mem.route?.distanceKm ?? 0)} km`
    : (mem.check?.text ?? p.title);
return {
  summary,
  method: `${p.research.length} paid lookup${p.research.length === 1 ? "" : "s"} via x402 on Arc${o ? ` · ${VENUE_NAME[o.venue]}` : ""}`,
  data: { move: p, check: mem.check, order: o, days: mem.days, places: mem.places, route: mem.route },
};
}
