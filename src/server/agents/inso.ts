import { SELLERS } from "../sellers";
import { PRODUCTS } from "../x402";
import { searchTerms, type MarketEvent, type OddsPoint } from "../gemini";
import type { AgentCtx, AgentDef, EditResult, LineDraft, PhaseDraft } from "./types";
import { PhaseFailure } from "./types";

interface Pick {
  event: string;
  label: string;
  symbol: string;
  last: number | null;
}

interface Opts {
  markets: number;
  tape: boolean;
  tf: "5m" | "15m" | "1hr";
  /** Events chosen by the planner; when absent, keyword search is used. */
  events?: { ticker: string; title: string }[];
}

const seller = SELLERS.primary;
const mirror = SELLERS.mirror;
const price = (product: string, n: number) => (PRODUCTS[product].price * BigInt(n)).toString();
const alt = (product: string, n: number) => [
  { payeeName: mirror.name, payee: mirror.address, service: product, price: ((PRODUCTS[product].price * mirror.markup * BigInt(n)) / 100n).toString() },
];

function stats(series: OddsPoint[]) {
  if (series.length === 0) return null;
  const ps = series.map((s) => s.p);
  let jump = 0;
  for (let i = 1; i < ps.length; i++) jump = Math.max(jump, Math.abs(ps[i] - ps[i - 1]));
  const first = ps[0];
  const last = ps[ps.length - 1];
  const recent = ps.slice(-Math.max(2, Math.floor(ps.length / 4)));
  const momentum = recent[recent.length - 1] - recent[0];
  return {
    first,
    last,
    change: last - first,
    high: Math.max(...ps),
    low: Math.min(...ps),
    biggestJump: jump,
    momentum,
    trend: Math.abs(momentum) < 0.02 ? "flat" : momentum > 0 ? "rising" : "falling",
  };
}

const pp = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)} pts`;

export const inso: AgentDef = {
  id: "inso",
  name: "Inso",
  tagline: "Tracks prediction-market odds and explains what moved.",
  examples: ["How have BTC odds moved today?", "Track ETH and SOL price markets", "What's moving in gold markets?"],
  defaults: { markets: 3, tape: true, tf: "15m" } satisfies Opts,
  faultPhase: "history",
  analysisPhase: "analyze",

  async plan(task, o) {
    const opts = o as unknown as Opts;
    const chosen = opts.events ?? [];
    const terms = chosen.length ? chosen.map((e) => e.title) : searchTerms(task);
    const product = chosen.length ? "markets.event" : "markets.search";
    const searches = Math.max(1, chosen.length || terms.length);
    const n = opts.markets;

    const lines: LineDraft[] = [
      {
        id: "discover",
        phaseId: "discover",
        purpose: chosen.length ? `Load ${searches} chosen ${searches === 1 ? "event" : "events"}` : `Find markets (${searches} ${searches === 1 ? "search" : "searches"})`,
        service: product,
        payeeName: seller.name,
        payee: seller.address,
        rail: "x402",
        approved: price(product, searches),
        calls: { max: searches, unitPrice: PRODUCTS[product].price.toString() },
      },
      {
        id: "history",
        phaseId: "history",
        purpose: `Odds history, ${n} markets`,
        service: "markets.history",
        payeeName: seller.name,
        payee: seller.address,
        rail: "x402",
        approved: price("markets.history", n),
        calls: { max: n, unitPrice: PRODUCTS["markets.history"].price.toString() },
      },
    ];
    if (opts.tape)
      lines.push({
        id: "tape",
        phaseId: "tape",
        purpose: `Trade tape, ${n} markets`,
        service: "markets.tape",
        payeeName: seller.name,
        payee: seller.address,
        rail: "x402",
        approved: price("markets.tape", n),
        calls: { max: n, unitPrice: PRODUCTS["markets.tape"].price.toString() },
      });

    const phases: PhaseDraft[] = [
      { id: "discover", label: chosen.length ? "Load markets" : "Find markets", sub: terms.length ? terms.join(" · ").slice(0, 80) : "top active", dependsOn: [], optional: false, lineId: "discover", alternatives: alt(product, searches) },
      { id: "history", label: "Buy odds history", sub: `${n} markets · ${opts.tf}`, dependsOn: ["discover"], optional: false, lineId: "history", alternatives: alt("markets.history", n) },
    ];
    if (opts.tape)
      phases.push({ id: "tape", label: "Buy trade tape", sub: "who's buying", dependsOn: ["discover"], optional: true, lineId: "tape", alternatives: alt("markets.tape", n) });
    phases.push(
      { id: "analyze", label: "Read the odds", sub: "moves · momentum", dependsOn: opts.tape ? ["history", "tape"] : ["history"], optional: false },
      { id: "deliver", label: "Odds report", sub: "chart + summary", dependsOn: ["analyze"], optional: false },
    );

    return {
      cards: [
        {
          kind: "deliverable",
          title: "Odds report",
          points: [`${n} markets · ${chosen.length ? `${chosen.length} events` : terms.length ? terms.join(", ") : "top active"}`, "Odds-over-time chart", "Biggest moves, momentum", ...(opts.tape ? ["Buyer vs seller flow"] : [])],
        },
        { kind: "risk", title: "Read-only", points: ["No trades placed", "Thin markets move on small trades", "Data as of purchase time"] },
        { kind: "method", title: "Pay per request", points: ["Gemini market data", "x402 on Arc, paid from vault", "Built-in analysis, no model fees"] },
      ],
      lines,
      phases,
    };
  },

  edit(_card, prompt, o): EditResult {
    const opts = { ...(o as unknown as Opts) };
    const p = prompt.toLowerCase();

    if (/(place|make|execute|real).*(trade|order|bet)|\bbuy (yes|no)\b|\bbet\b/.test(p))
      return {
        ok: false,
        message: "Inso is read-only. Placing orders needs a Gemini trading key and its own approved spend.",
        alternatives: ["Track 5 markets", "Drop the trade tape"],
      };
    if (/guarantee|sure thing|risk.?free|can't lose/.test(p))
      return { ok: false, message: "Odds are probabilities, not promises.", alternatives: ["Track 5 markets", "Add trade tape"] };
    if (/free|zero cost|no cost/.test(p))
      return { ok: false, message: "Market data is paid per request. Lowest plan is 1 market, no tape.", alternatives: ["1 market, no tape"] };

    let changed = false;
    const m = p.match(/(\d+)\s*(market|contract)/);
    if (m) {
      const n = Number(m[1]);
      if (n < 1 || n > 5) return { ok: false, message: "1 to 5 markets per order.", alternatives: ["5 markets", "1 market"] };
      opts.markets = n;
      changed = true;
    }
    if (/(no|skip|drop|remove|without)\b.*\b(tape|trades|flow)/.test(p)) {
      opts.tape = false;
      changed = true;
    } else if (/(add|include|with)\b.*\b(tape|trades|flow)/.test(p)) {
      opts.tape = true;
      changed = true;
    }
    if (/cheap|lower|less|reduce|smaller|budget/.test(p) && !m) {
      opts.markets = Math.max(1, opts.markets - 1);
      opts.tape = false;
      changed = true;
    }
    if (/\b5 ?m(in)?\b|five minute/.test(p)) (opts.tf = "5m"), (changed = true);
    else if (/\b15 ?m(in)?\b/.test(p)) (opts.tf = "15m"), (changed = true);
    else if (/\b1 ?h(ou)?r?\b|hourly/.test(p)) (opts.tf = "1hr"), (changed = true);

    if (!changed)
      return {
        ok: false,
        message: "Not something Inso can change.",
        alternatives: ["Track 5 markets", "Drop the trade tape", "Use 1h candles", "Make it cheaper"],
      };
    return { ok: true, message: "Updated", options: opts as unknown as Record<string, unknown> };
  },

  async runPhase(id, ctx: AgentCtx) {
    const opts = ctx.options as unknown as Opts;
    const mem = ctx.memory as { picks?: Pick[]; history?: Record<string, OddsPoint[]>; tape?: Record<string, { p: number; size: number; side: string }[]>; analysis?: unknown[] };

    if (id === "discover") {
      const events: MarketEvent[] = [];
      if (opts.events?.length) {
        for (const [i, e] of opts.events.entries()) {
          events.push(await ctx.buy<MarketEvent>("discover", "markets.event", { ticker: e.ticker }, `event:${e.ticker}`));
          ctx.progress((i + 1) / opts.events.length, e.title);
        }
      } else {
        const terms = searchTerms(ctx.task);
        const queries = terms.length ? terms : [""];
        for (const [i, q] of queries.entries()) {
          events.push(...(await ctx.buy<MarketEvent[]>("discover", "markets.search", { q, limit: "5" }, `search:${q}`)));
          ctx.progress((i + 1) / queries.length, `${events.length} events`);
        }
      }
      // Prefer contracts that have traded, then the most uncertain; spread picks across events.
      const ranked = events
        .sort((a, b) => b.volume - a.volume)
        .map((e) => [...e.contracts].filter((c) => c.symbol).sort((a, b) => Number(b.last != null) - Number(a.last != null) || Math.abs((a.last ?? 0.5) - 0.5) - Math.abs((b.last ?? 0.5) - 0.5)).map((c) => ({ e, c })));
      const picks: Pick[] = [];
      for (let round = 0; picks.length < opts.markets && ranked.some((r) => r[round]); round++)
        for (const r of ranked) {
          const x = r[round];
          if (x && picks.length < opts.markets && !picks.some((p) => p.symbol === x.c.symbol)) picks.push({ event: x.e.title, label: x.c.label, symbol: x.c.symbol, last: x.c.last });
        }
      if (picks.length === 0) throw new PhaseFailure("unknown", "No active markets match this task");
      mem.picks = picks;
      ctx.progress(1, `${picks.length} markets picked`);
      return;
    }

    if (id === "history") {
      mem.history ??= {};
      const picks = mem.picks ?? [];
      for (const [i, pick] of picks.entries()) {
        mem.history[pick.symbol] = await ctx.buy<OddsPoint[]>("history", "markets.history", { symbol: pick.symbol, tf: opts.tf }, `history:${pick.symbol}`);
        ctx.progress((i + 1) / picks.length, pick.event);
      }
      if (ctx.fault("policy_block")) {
        // Agent wants data that isn't in the plan: the policy routes it to you.
        await ctx.buy("extra-history", "markets.history", { symbol: picks[0].symbol, tf: "1hr" }, `history-extra:${picks[0].symbol}`);
      }
      return;
    }

    if (id === "tape") {
      mem.tape ??= {};
      const picks = mem.picks ?? [];
      for (const [i, pick] of picks.entries()) {
        mem.tape[pick.symbol] = await ctx.buy("tape", "markets.tape", { symbol: pick.symbol }, `tape:${pick.symbol}`);
        ctx.progress((i + 1) / picks.length, pick.event);
      }
      return;
    }

    if (id === "analyze") {
      if (ctx.fault("model_error")) throw new PhaseFailure("model_error", "Analysis crashed mid-run");
      mem.analysis = (mem.picks ?? []).map((pick) => {
        const series = mem.history?.[pick.symbol] ?? [];
        const trades = mem.tape?.[pick.symbol];
        const buys = trades?.filter((t) => t.side === "buy").reduce((a, t) => a + t.size, 0) ?? 0;
        const sells = trades?.filter((t) => t.side === "sell").reduce((a, t) => a + t.size, 0) ?? 0;
        return { ...pick, series, stats: stats(series), flow: trades ? { buys, sells, trades: trades.length } : null };
      });
      ctx.progress(1);
      return;
    }

    if (id === "deliver") {
      ctx.progress(1);
      return;
    }
  },

  deliver(ctx) {
    const analysis = (ctx.memory.analysis ?? []) as { event: string; label: string; stats: ReturnType<typeof stats> }[];
    const movers = analysis.filter((a) => a.stats).sort((a, b) => Math.abs(b.stats!.change) - Math.abs(a.stats!.change));
    const top = movers[0];
    return {
      summary: top ? `Biggest move: ${top.event} · ${top.label} ${pp(top.stats!.change)}` : "Markets were flat",
      method: "Gemini Prediction Markets via x402 on Arc",
      data: { markets: analysis },
    };
  },
};
