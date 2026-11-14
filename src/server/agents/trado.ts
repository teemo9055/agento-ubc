import { SELLERS } from "../sellers";
import { PRODUCTS } from "../x402";
import type { MarketEvent, OddsPoint } from "../gemini";
import type { AgentDef, EditResult, LineDraft, PhaseDraft } from "./types";
import { PhaseFailure } from "./types";

interface Opts {
  symbols: string[];
  odds: boolean;
}

const COINS: Record<string, string> = { btc: "btcusd", bitcoin: "btcusd", eth: "ethusd", ethereum: "ethusd", sol: "solusd", solana: "solusd", doge: "dogeusd", link: "linkusd" };
const TICKER: Record<string, string> = { btcusd: "BTC", ethusd: "ETH", solusd: "SOL", dogeusd: "DOGE", linkusd: "LINK" };

const seller = SELLERS.primary;
const mirror = SELLERS.mirror;
const P = (id: string) => PRODUCTS[id].price;

function symbolsIn(text: string): string[] {
  const out: string[] = [];
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) if (COINS[w] && !out.includes(COINS[w])) out.push(COINS[w]);
  return out.length ? out.slice(0, 3) : ["btcusd"];
}

const sma = (xs: number[], n: number) => (xs.length >= n ? xs.slice(-n).reduce((a, b) => a + b, 0) / n : null);

function indicators(hourly: OddsPoint[], daily: OddsPoint[]) {
  const h = hourly.map((x) => x.p);
  const d = daily.map((x) => x.p);
  const last = h[h.length - 1] ?? d[d.length - 1];
  const ago = (xs: number[], n: number) => (xs.length > n ? xs[xs.length - 1 - n] : xs[0]);
  const rets = h.slice(1).map((x, i) => Math.log(x / h[i]));
  const mean = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
  const vol = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1)) * Math.sqrt(24);
  const s20 = sma(h, 20);
  const s50 = sma(h, 50);
  return {
    last,
    change24h: last / ago(h, 24) - 1,
    change7d: last / ago(d, 7) - 1,
    sma20: s20,
    sma50: s50,
    dailyVol: vol,
    trend: s20 && s50 ? (s20 > s50 * 1.002 ? "up" : s20 < s50 * 0.998 ? "down" : "sideways") : "sideways",
  };
}

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

export const trado: AgentDef = {
  id: "trado",
  name: "Trado",
  tagline: "Charts first, feelings later.",
  examples: ["Is BTC trending this week?", "Compare ETH and SOL momentum", "BTC trend plus what prediction markets think"],
  defaults: { symbols: [], odds: true } satisfies Opts,
  faultPhase: "candles",
  analysisPhase: "signal",

  async plan(task, o) {
    const opts = o as unknown as Opts;
    const symbols = opts.symbols.length ? opts.symbols : symbolsIn(task);
    const names = symbols.map((s) => TICKER[s] ?? s.toUpperCase()).join(", ");
    const n = symbols.length;
    const lines: LineDraft[] = [
      {
        id: "candles",
        phaseId: "candles",
        purpose: `Price candles, ${n} × 2 timeframes`,
        service: "spot.candles",
        payeeName: seller.name,
        payee: seller.address,
        rail: "x402",
        approved: (P("spot.candles") * BigInt(n * 2)).toString(),
        calls: { max: n * 2, unitPrice: P("spot.candles").toString() },
      },
    ];
    if (opts.odds)
      lines.push({
        id: "odds",
        phaseId: "odds",
        purpose: `Market odds, ${n} ${n === 1 ? "coin" : "coins"}`,
        service: "markets.search + history",
        payeeName: seller.name,
        payee: seller.address,
        rail: "x402",
        approved: ((P("markets.search") + P("markets.history")) * BigInt(n)).toString(),
        calls: { max: n * 2, unitPrice: P("markets.history").toString() },
      });
    const phases: PhaseDraft[] = [
      {
        id: "candles",
        label: "Buy price candles",
        sub: `${names} · 1h + 1d`,
        dependsOn: [],
        optional: false,
        lineId: "candles",
        alternatives: [{ payeeName: mirror.name, payee: mirror.address, service: "spot.candles", price: ((P("spot.candles") * mirror.markup * BigInt(n * 2)) / 100n).toString() }],
      },
      { id: "indicators", label: "Crunch indicators", sub: "SMA · momentum · vol", dependsOn: ["candles"], optional: false },
    ];
    if (opts.odds) phases.push({ id: "odds", label: "Check market odds", sub: "what bettors think", dependsOn: [], optional: true, lineId: "odds" });
    phases.push(
      { id: "signal", label: "Call the trend", sub: "up · down · sideways", dependsOn: opts.odds ? ["indicators", "odds"] : ["indicators"], optional: false },
      { id: "deliver", label: "Trend brief", sub: "chart + call", dependsOn: ["signal"], optional: false },
    );
    return {
      cards: [
        { kind: "deliverable", title: "Trend brief", points: [names, "Price chart, 1h + 1d", "Trend call with SMA cross", ...(opts.odds ? ["Prediction-market odds"] : [])] },
        { kind: "risk", title: "Not advice", points: ["No orders placed", "Indicators lag price", "Crypto moves 24/7"] },
        { kind: "method", title: "Pay per request", points: ["Gemini spot candles", "x402 on Arc, paid from vault", "Built-in indicators"] },
      ],
      lines,
      phases,
    };
  },

  edit(_card, prompt, o): EditResult {
    const opts = { ...(o as unknown as Opts) };
    const p = prompt.toLowerCase();
    if (/(place|make|execute|open).*(trade|order|position)|leverage|short it|long it/.test(p))
      return { ok: false, message: "Trado reads charts. It doesn't place orders.", alternatives: ["Add ETH", "Add prediction-market odds"] };
    if (/guarantee|sure|can't lose|moon/.test(p)) return { ok: false, message: "No one can promise price moves.", alternatives: ["Add ETH", "Drop market odds"] };
    let changed = false;
    const syms = symbolsIn(p);
    if (/(add|include|also|compare)/.test(p) && Object.keys(COINS).some((c) => p.includes(c))) {
      opts.symbols = [...new Set([...(opts.symbols.length ? opts.symbols : []), ...syms])];
      if (opts.symbols.length > 3) return { ok: false, message: "Up to 3 coins per order.", alternatives: ["Only BTC"] };
      changed = true;
    } else if (/(only|just|switch to)/.test(p) && Object.keys(COINS).some((c) => p.includes(c))) {
      opts.symbols = syms;
      changed = true;
    }
    if (/(no|skip|drop|without)\b.*\b(odds|prediction|market)/.test(p)) (opts.odds = false), (changed = true);
    else if (/(add|include|with)\b.*\b(odds|prediction)/.test(p)) (opts.odds = true), (changed = true);
    if (/cheap|less|lower|budget/.test(p)) (opts.odds = false), (changed = true);
    if (!changed) return { ok: false, message: "Not something Trado can change.", alternatives: ["Add ETH", "Only BTC", "Drop market odds"] };
    return { ok: true, message: "Updated", options: opts as unknown as Record<string, unknown> };
  },

  async runPhase(id, ctx) {
    const opts = ctx.options as unknown as Opts;
    const symbols = opts.symbols.length ? opts.symbols : symbolsIn(ctx.task);
    const mem = ctx.memory as {
      candles?: Record<string, { hourly: OddsPoint[]; daily: OddsPoint[] }>;
      ind?: Record<string, ReturnType<typeof indicators>>;
      odds?: Record<string, { title: string; label: string; series: OddsPoint[] } | null>;
      signals?: unknown[];
    };

    if (id === "candles") {
      mem.candles ??= {};
      let i = 0;
      for (const s of symbols) {
        const hourly = await ctx.buy<OddsPoint[]>("candles", "spot.candles", { symbol: s, tf: "1hr" }, `candles:${s}:1hr`);
        ctx.progress(++i / (symbols.length * 2), `${TICKER[s]} 1h`);
        const daily = await ctx.buy<OddsPoint[]>("candles", "spot.candles", { symbol: s, tf: "1day" }, `candles:${s}:1day`);
        ctx.progress(++i / (symbols.length * 2), `${TICKER[s]} 1d`);
        mem.candles[s] = { hourly, daily };
      }
      return;
    }
    if (id === "indicators") {
      mem.ind = Object.fromEntries(symbols.map((s) => [s, indicators(mem.candles![s].hourly, mem.candles![s].daily)]));
      ctx.progress(1);
      return;
    }
    if (id === "odds") {
      mem.odds ??= {};
      for (const [i, s] of symbols.entries()) {
        const t = TICKER[s] ?? s;
        const events = await ctx.buy<MarketEvent[]>("odds", "markets.search", { q: t, limit: "3" }, `odds-search:${t}`);
        const c = events.flatMap((e) => e.contracts.map((c) => ({ e, c }))).filter((x) => x.c.symbol).sort((a, b) => Math.abs((a.c.last ?? 0.5) - 0.5) - Math.abs((b.c.last ?? 0.5) - 0.5))[0];
        if (c) {
          const series = await ctx.buy<OddsPoint[]>("odds", "markets.history", { symbol: c.c.symbol, tf: "15m" }, `odds-history:${c.c.symbol}`);
          mem.odds[s] = { title: c.e.title, label: c.c.label, series };
        } else mem.odds[s] = null;
        ctx.progress((i + 1) / symbols.length, t);
      }
      return;
    }
    if (id === "signal") {
      if (ctx.fault("model_error")) throw new PhaseFailure("model_error", "Signal model crashed mid-run");
      mem.signals = symbols.map((s) => ({ symbol: s, ticker: TICKER[s] ?? s, ...mem.ind![s], odds: mem.odds?.[s] ?? null, hourly: mem.candles![s].hourly.slice(-72) }));
      ctx.progress(1);
      return;
    }
    ctx.progress(1);
  },

  deliver(ctx) {
    const sig = (ctx.memory.signals ?? []) as { ticker: string; trend: string; change24h: number; change7d: number }[];
    return {
      summary: sig.map((s) => `${s.ticker} ${s.trend} · 24h ${pct(s.change24h)} · 7d ${pct(s.change7d)}`).join(" | "),
      method: "Gemini spot candles via x402 on Arc",
      data: { signals: ctx.memory.signals },
    };
  },
};
